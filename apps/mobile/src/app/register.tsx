import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '@/components/BackButton';
import { GoogleButton } from '@/components/GoogleButton';
import { useHumanCheck } from '@/components/HumanCheck';
import { Icon } from '@/components/Icon';
import { InlineBadge } from '@/components/NameWithBadge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ApiError, api, inviteStore, type Badged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SITE_URL } from '@/lib/config';
import { needsHumanCheck, registerStepFor, securityErrorText } from '@/lib/humanCheck';
import { colors } from '@/lib/theme';
import { goBack } from '@/lib/nav';
import { Field, Screen, authStyles } from './login';
import { t } from '@/lib/i18n';
import { T } from '@/components/Trans';

const MIN_AGE = 15;
type Key = 'displayName' | 'username' | 'email' | 'birthDate' | 'gender' | 'password';

const steps: { key: Key; title: string; sub: string; placeholder: string; icon: 'user' | 'at' | 'mail' | 'calendar' | 'lock' | null; cta: string }[] = [
  { key: 'displayName', get title() { return t('Como te chamas?'); }, get sub() { return t('Diz-nos o teu nome, não mordemos'); }, get placeholder() { return t('Nome'); }, icon: 'user', get cta() { return t('Seguinte'); } },
  { key: 'username', get title() { return t('Qual vai ser o teu @?'); }, get sub() { return t('É único: só tu o podes ter'); }, get placeholder() { return t('utilizador'); }, icon: 'at', get cta() { return t('Seguinte'); } },
  { key: 'email', get title() { return t('E o teu email?'); }, get sub() { return t('Prometemos não fazer spam'); }, placeholder: 'email@exemplo.com', icon: 'mail', get cta() { return t('Seguinte'); } },
  { key: 'birthDate', get title() { return t('Quando nasceste?'); }, get sub() { return t('Para confirmar que tens {minAge}+ anos. Ninguém vê esta data', { minAge: MIN_AGE }); }, placeholder: 'AAAA-MM-DD', icon: 'calendar', get cta() { return t('Seguinte'); } },
  { key: 'gender', get title() { return t('Como te identificas?'); }, get sub() { return t('Só tu decides se isto aparece no teu perfil'); }, placeholder: '', icon: null, get cta() { return t('Seguinte'); } },
  { key: 'password', get title() { return t('Agora uma senha'); }, get sub() { return t('Mínimo 10 caracteres. Nada de «123456», ok?'); }, get placeholder() { return t('Senha'); }, icon: 'lock', get cta() { return t('Criar conta'); } },
];

const ageOf = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  const n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--;
  return a;
};

/** Devolve o problema do valor ou null. Corre a cada tecla, sem esperar pelo servidor. */
export function problemOf(key: Key, raw: string): string | null {
  const v = key === 'username' ? raw.trim().replace(/^@/, '') : raw.trim();
  if (key === 'displayName') return v.length === 0 ? t('Diz-nos o teu nome') : v.length > 60 ? t('Nome demasiado comprido') : null;
  if (key === 'username') {
    if (v.length < 3) return t('Mínimo 3 caracteres');
    if (v.length > 30) return t('Máximo 30 caracteres');
    return /^[a-zA-Z0-9_.]+$/.test(v) ? null : t('Só letras, números, «_» e «.», sem espaços');
  }
  if (key === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : t('Esse email não parece certo');
  if (key === 'gender') return v ? null : t('Escolhe uma opção');
  if (key === 'birthDate') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return 'Data inválida (AAAA-MM-DD)';
    if (ageOf(v) < MIN_AGE) return t('Tens de ter pelo menos {minAge} anos para criar conta', { minAge: MIN_AGE });
    return ageOf(v) > 120 ? t('Data inválida') : null;
  }
  return raw.length >= 10 ? null : t('Mínimo 10 caracteres');
}

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string; suggestions?: string[]; taken?: boolean } | { state: 'error' };

/** Disponibilidade do @ / email em tempo real: validação local imediata + pergunta ao servidor (com pausa de 350 ms). */
export function useAvailability(kind: 'username' | 'email', raw: string, enabled: boolean): Check {
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  useEffect(() => {
    const value = kind === 'username' ? raw.trim().replace(/^@/, '') : raw.trim();
    if (!enabled || !value) return setCheck({ state: 'idle' });
    const local = problemOf(kind, raw);
    if (local) return setCheck({ state: 'bad', message: local });
    setCheck({ state: 'checking' });
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        if (kind === 'username') {
          const r = await api.usernameAvailable(value);
          if (stale) return;
          if (r.available) return setCheck({ state: 'ok' });
          setCheck(r.reason === 'taken' ? { state: 'bad', taken: true, message: t('@{value} já tem dono', { value }), suggestions: r.suggestions } : { state: 'bad', message: r.reason === 'reserved' ? t('Esse nome está reservado') : t('Nome de utilizador inválido') });
        } else {
          const r = await api.emailAvailable(value);
          if (stale) return;
          setCheck(r.available ? { state: 'ok' } : { state: 'bad', taken: r.reason === 'taken', message: r.reason === 'taken' ? t('Este email já tem conta') : t('Esse email não parece certo') });
        }
      } catch {
        if (!stale) setCheck({ state: 'error' }); // sem rede: deixa continuar, o servidor valida no fim
      }
    }, 350);
    return () => { stale = true; clearTimeout(timer); };
  }, [kind, raw, enabled]);
  return check;
}

function strength(p: string) {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(p)).length;
  if (p.length < 10) return { level: 1, label: t('Ainda fraca'), color: colors.danger };
  if (p.length >= 14 || kinds >= 3) return { level: 3, label: t('Forte'), color: '#22c55e' };
  return { level: 2, label: t('Boa'), color: '#fbbf24' };
}

/** Criar conta em 6 passos, como no site. */
export default function Register() {
  const router = useRouter();
  const { signUp } = useAuth();
  const styles2 = authStyles();
  const legal = (p: string) => (Platform.OS === 'web' ? router.push(p as never) : void Linking.openURL(`${SITE_URL || 'https://txillapp.com'}${p}`));
  const [i, setI] = useState(0);
  const [data, setData] = useState<Partial<Record<Key, string>> & { acceptTerms?: boolean }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<({ code: string; displayName: string } & Badged) | null>(null);
  const step = steps[i];
  const value = String(data[step.key] ?? '');
  const kind = step.key === 'username' || step.key === 'email' ? step.key : null;
  const check = useAvailability(kind ?? 'username', value, kind !== null);
  const local = value ? problemOf(step.key, value) : null;
  const termsMissing = step.key === 'password' && !data.acceptTerms;
  const blocked = termsMissing || !value.trim() || !!local || (kind !== null && (check.state === 'checking' || check.state === 'bad'));
  const gen = useRef(0);
  void gen;
  const human = useHumanCheck();
  // Convite: vem na ligação (?convite=CÓDIGO) e fica guardado até o registo acabar.
  const { convite } = useLocalSearchParams<{ convite?: string }>();
  useEffect(() => {
    let alive = true;
    (async () => {
      let code = String(convite ?? '').trim().toUpperCase().slice(0, 20);
      if (code) await inviteStore.set(code);
      else code = await inviteStore.get();
      if (!code) return;
      try {
        const p = await api.invitePreview(code);
        if (alive) setInvite({ code, displayName: p.displayName, verified: p.verified, verifiedTier: p.verifiedTier });
      } catch {
        await inviteStore.clear();
      }
    })();
    return () => { alive = false; };
  }, [convite]);

  async function next() {
    if (busy) return;
    if (blocked) return setError(termsMissing ? t('Tens de aceitar os Termos e a Política de Privacidade') : local ?? (check.state === 'bad' ? check.message : value ? t('Só um segundinho…') : t('Preenche este campo')));
    setError('');
    if (i < steps.length - 1) return setI(i + 1);
    setBusy(true);
    try {
      const body = {
        email: String(data.email).trim(),
        username: String(data.username).trim().replace(/^@/, ''),
        displayName: String(data.displayName).trim(),
        password: String(data.password),
        birthDate: String(data.birthDate).trim(),
        gender: data.gender,
        acceptTerms: true as const,
        inviteCode: invite?.code,
      };
      // Prova de humano (invisível; sem a chave do site não faz nada). Se o código falhar no servidor, tenta-se outro uma vez.
      try {
        await signUp(body, await human.getToken());
      } catch (x) {
        if (!(x instanceof ApiError) || !needsHumanCheck(x)) throw x;
        await signUp(body, await human.getToken());
      }
      void inviteStore.clear();
      // Daqui para a frente é o _layout (Gate) que leva ao Início (ou à página que se pediu antes de entrar): um só
      // `replace`, sem dois saltos seguidos. O botão fica em "a criar" até a página mudar (sem segundo registo com dois toques).
    } catch (x) {
      const msg = (x as Error).message;
      if (x instanceof ApiError && x.status === 409) {
        setI(/email/i.test(msg) ? 2 : 1);
        setError(/email/i.test(msg) ? t('Esse email já tem conta') : t('Esse @ acabou de ser escolhido por outra pessoa'));
      } else if (x instanceof ApiError) {
        // Email temporário: volta ao passo do email. Limites, prova de humano e servidor ocupado: o texto certo.
        if (registerStepFor(x) === 'email') setI(steps.findIndex((s) => s.key === 'email'));
        setError(securityErrorText(x, 'register'));
      } else setError(msg);
      setBusy(false);
    }
  }
  function back() {
    if (i === 0) goBack(router, '/login');
    else { setError(''); setI(i - 1); }
  }
  const set = (v: string) => { setError(''); setData({ ...data, [step.key]: v }); };
  // Data: põe os hífenes sozinho (AAAA-MM-DD).
  const onDate = (t: string) => {
    const d = t.replace(/\D/g, '').slice(0, 8);
    set(d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d);
  };
  const s = step.key === 'password' ? strength(value) : null;
  const status = kind ? (check.state === 'ok' ? 'ok' : check.state === 'bad' ? 'bad' : check.state === 'checking' ? 'checking' : undefined) : undefined;

  return (
    <>
    <Screen>
      <View style={st.topRow}>
        <BackButton onPress={back} style={st.back} />
        <View style={st.bars} accessibilityRole="progressbar">
          {steps.map((_, n) => <View key={n} style={[st.bar, { backgroundColor: n <= i ? colors.brand : colors.zinc300 }]} />)}
        </View>
      </View>

      <View style={{ marginTop: 40 }}>
        {invite && i === 0 && <Text style={st.invite}><T text={t('Convite de {displayName}<badge/>: os dois ganham vibes quando entrares a sério.', { displayName: invite.displayName })} tags={{ badge: () => <InlineBadge who={invite} fontSize={15} /> }} /></Text>}
        <Text style={st.title}>{step.title}</Text>
        <Text style={st.sub}>{step.sub}</Text>

        <View style={{ marginTop: 28 }}>
          {step.key === 'gender' ? (
            <View style={{ flexDirection: 'row', gap: 12 }} accessibilityRole="radiogroup">
              {[['female', t('Feminino')], ['male', t('Masculino')]].map(([v, label]) => {
                const on = data.gender === v;
                return (
                  <Pressable key={v} onPress={() => set(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[st.opt, on ? { borderColor: colors.brand, backgroundColor: colors.rose50 } : { borderColor: colors.zinc200, backgroundColor: '#fff' }]}>
                    <Text style={[st.optText, on && { color: colors.brand }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Field
              key={step.key}
              icon={step.icon as 'user'}
              value={value}
              onChangeText={step.key === 'birthDate' ? onDate : set}
              placeholder={step.placeholder}
              secure={step.key === 'password'}
              status={status}
              autoFocus
              autoCapitalize={step.key === 'displayName' ? 'words' : 'none'}
              keyboardType={step.key === 'email' ? 'email-address' : step.key === 'birthDate' ? 'number-pad' : 'default'}
              autoComplete={step.key === 'email' ? 'email' : step.key === 'password' ? 'new-password' : step.key === 'username' ? 'username' : step.key === 'displayName' ? 'name' : 'off'}
              returnKeyType={step.key === 'password' ? 'go' : 'next'}
              onSubmitEditing={() => void next()}
              accessibilityLabel={step.placeholder}
            />
          )}
          {step.key === 'username' && (
            <View style={st.avail}>
              {check.state === 'checking' && <Text style={st.hint}>{t('A verificar…')}</Text>}
              {check.state === 'ok' && <Text style={[st.hint, { color: colors.green600, fontWeight: '600' }]}>{t('@{value} está livre', { value: value.trim().replace(/^@/, '') })}</Text>}
              {check.state === 'bad' && (
                <View>
                  <Text style={[st.hint, { color: colors.danger, fontWeight: '600' }]}>{check.message}</Text>
                  {check.suggestions && check.suggestions.length > 0 && (
                    <View style={st.sugs}>
                      {check.suggestions.slice(0, 4).map((u) => <Chip key={u} label={`@${u}`} onPress={() => set(u)} style={st.sug} />)}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
          {step.key === 'email' && check.state === 'bad' && (
            <View style={st.avail}>
              <Text style={[st.hint, { color: colors.danger, fontWeight: '600' }]}>{check.message}</Text>
              {check.taken && <Text style={st.link} onPress={() => router.replace('/login')}>{t('Já tens conta? Entra aqui')}</Text>}
            </View>
          )}
          {step.key === 'displayName' && value && local ? <Text style={[st.hint, { color: colors.danger, marginTop: 12 }]}>{local}</Text> : null}
          {step.key === 'birthDate' && value.length === 10 && local ? <Text style={[st.hint, { color: colors.danger, marginTop: 12 }]}>{local}</Text> : null}
          {s && value.length > 0 && (
            <View style={st.strength}>
              <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                {[1, 2, 3].map((n) => <View key={n} style={[st.sbar, { backgroundColor: n <= s.level ? s.color : colors.zinc300 }]} />)}
              </View>
              <Text style={st.hint}>{s.label}</Text>
            </View>
          )}
          {step.key === 'password' && (
            <Pressable onPress={() => { setError(''); setData({ ...data, acceptTerms: !data.acceptTerms }); }} style={st.terms} accessibilityRole="checkbox" accessibilityState={{ checked: !!data.acceptTerms }}>
              <View style={[st.box, data.acceptTerms && { backgroundColor: colors.brand, borderColor: colors.brand }]}>{data.acceptTerms && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}</View>
              <Text style={st.termsText}>
                <T text={t('Li e aceito os <terms>Termos de Uso</terms> e a <privacy>Política de Privacidade</privacy>.')} tags={{ terms: (s) => <Text style={st.link} onPress={() => legal('/terms')}>{s}</Text>, privacy: (s) => <Text style={st.link} onPress={() => legal('/privacy')}>{s}</Text> }} />
              </Text>
            </Pressable>
          )}
        </View>
        {i === 0 && <GoogleButton mode="register" onError={setError} />}
      </View>

      <View style={st.alert} accessibilityRole="alert"><Text style={st.alertText}>{error}</Text></View>
      <View style={{ marginTop: 'auto', paddingBottom: 24 }}>
        <Button label={step.cta} onPress={() => void next()} loading={busy} disabled={blocked} block style={styles2.cta} />
      </View>
    </Screen>
    {human.node}
    </>
  );
}

const st = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 8 },
  back: { marginLeft: -12 },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 6, borderRadius: 3 },
  invite: { marginBottom: 16, borderRadius: 16, backgroundColor: '#ecfdf5', paddingHorizontal: 16, paddingVertical: 10, textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#065f46', overflow: 'hidden' },
  title: { fontSize: 36, fontWeight: '300', lineHeight: 40, color: colors.zinc900 },
  sub: { marginTop: 12, fontSize: 20, fontWeight: '300', lineHeight: 28, color: colors.zinc600 },
  opt: { flex: 1, minHeight: 72, borderWidth: 2, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optText: { fontSize: 15, fontWeight: '700', color: colors.zinc800 },
  avail: { marginTop: 12, minHeight: 52, paddingHorizontal: 4 },
  hint: { fontSize: 14, color: colors.zinc600 },
  sugs: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  /** Chip branco por cima do fundo creme do registo. */
  sug: { backgroundColor: '#fff' },
  link: { marginTop: 4, fontSize: 14, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' },
  strength: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  sbar: { flex: 1, height: 6, borderRadius: 3 },
  terms: { marginTop: 24, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 4 },
  box: { marginTop: 2, width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  termsText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc700 },
  alert: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  alertText: { fontSize: 15, color: colors.danger, textAlign: 'center' },
});
