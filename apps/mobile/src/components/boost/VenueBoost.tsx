import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PontoLoader } from '@/components/PontoLoader';
import { boostsApi, type BoostCampaign, type BoostOptions } from '@/lib/api.boosts';
import { newKey } from '@/lib/api.extra';
import type { Venue } from '@/lib/api.locais';
import { STATE_LABEL, priceFor, refundPreview, reportLines, shortWhen, txills, type BoostPackageId } from '@/lib/boostView';
import { sized } from '@/lib/config';
import { iap } from '@/lib/iap';
import { iapMessage, type IapOutcome, type StoreProduct } from '@/lib/iap/core';
import { boostPackLabel, boostPackageFor, storeName } from '@/lib/iap/view';
import { IAP_PLATFORM, useIapCatalog, usePurchases } from '@/lib/purchases';
import { eventWhen } from '@/lib/nearbyView';
import { colors } from '@/lib/theme';

export const boostKey = (slug: string) => ['venue-boosts', slug] as const;
const optionsKey = (slug: string) => ['venue-boost-options', slug] as const;

/** Confirmação igual no telemóvel e no site. */
function confirmThen(title: string, text: string, ok: string, go: () => void) {
  if (Platform.OS === 'web') {
    if (confirm(`${title}\n\n${text}`)) go();
    return;
  }
  Alert.alert(title, text, [{ text: 'Cancelar', style: 'cancel' }, { text: ok, onPress: go }]);
}

/**
 * Gerir › Bombar: destacar um evento ou uma publicação do local no feed e no mapa de quem está perto, pago com os Txills
 * da carteira do local. Mostra o custo e o saldo, as campanhas ativas e passadas com o relatório (só totais) e deixa parar.
 * Só o dono e os administradores bombam.
 * Nas versões das lojas (lib/storeRules.ts) não se criam campanhas novas, porque o destaque é publicidade dentro da app e
 * teria de ser pago com a compra da loja: veem-se e param-se as que já existem.
 */
export function VenueBoost({ v }: { v: Venue }) {
  const qc = useQueryClient();
  const rules = usePurchases();
  const enabled = v.canEdit;
  const opts = useQuery({ queryKey: optionsKey(v.slug), queryFn: () => boostsApi.options(v.slug), enabled, retry: false });
  const camps = useQuery({ queryKey: boostKey(v.slug), queryFn: () => boostsApi.list(v.slug), enabled, retry: false });
  const o = opts.data;
  const [target, setTarget] = useState<{ kind: 'event' | 'post'; id: string } | null>(null);
  const [pkg, setPkg] = useState<BoostPackageId>('1d');
  const [radius, setRadius] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // A mesma chave até a campanha ficar criada: carregar outra vez depois de uma falha de rede nunca cobra duas vezes.
  const key = useRef(newKey());

  useEffect(() => {
    if (!o) return;
    setRadius((r) => (r >= o.radius.min && r <= o.radius.max ? r : o.radius.default));
    if (!target) {
      const first = o.targets.events[0] ? { kind: 'event' as const, id: o.targets.events[0].id } : o.targets.posts[0] ? { kind: 'post' as const, id: o.targets.posts[0].id } : null;
      if (first) setTarget(first);
    }
  }, [o, target]);

  if (!enabled) {
    return (
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={st.hint}>Só o dono e os administradores podem bombar o local. Fala com eles para destacar um evento ou uma publicação.</Text>
      </View>
    );
  }
  if (opts.isLoading || camps.isLoading) return <View style={{ alignItems: 'center', paddingVertical: 40 }}><PontoLoader size={20} /></View>;
  if (!o) return <Text style={[st.hint, { paddingHorizontal: 16 }]}>{(opts.error as Error | null)?.message || 'Não consegui abrir o Bombar agora. Puxa para atualizar.'}</Text>;

  const price = priceFor(o.packages, pkg, radius);
  const short = price != null && o.balance < price;
  const mzn = o.payments.find((p) => p.id === 'mzn');
  const pkgInfo = o.packages.find((p) => p.id === pkg);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: boostKey(v.slug) }), qc.invalidateQueries({ queryKey: optionsKey(v.slug) }), qc.invalidateQueries({ queryKey: ['venue', v.slug] })]);

  const submit = () => {
    if (!target || price == null) return;
    confirmThen(
      `Bombar por ${txills(price)}?`,
      `${pkgInfo?.label ?? ''} num raio de ${radius} km à volta do local, a começar agora. Sai da carteira do local (tem ${txills(o.balance)}).`,
      'Bombar',
      () => void (async () => {
        setBusy(true);
        setMsg(null);
        try {
          const r = await boostsApi.create(v.slug, { target, package: pkg, radiusKm: radius, payment: 'txills', idempotencyKey: key.current });
          key.current = newKey();
          setMsg({ ok: true, text: `Está a bombar! Ficam ${txills(r.balance)} na carteira do local.` });
          await refresh();
        } catch (e) {
          setMsg({ ok: false, text: (e as Error).message || 'Não deu. Tenta outra vez.' });
        }
        setBusy(false);
      })(),
    );
  };

  const stop = (c: BoostCampaign) => {
    const back = refundPreview(c);
    confirmThen(
      'Parar a campanha?',
      back > 0 ? `Voltam ${txills(back)} para a carteira do local (os dias inteiros que faltam).` : 'Já não há dias inteiros por usar: não há devolução. O destaque deixa de aparecer logo.',
      'Parar',
      () => void (async () => {
        try {
          const r = await boostsApi.stop(c.id);
          setMsg({ ok: true, text: r.refunded > 0 ? `Campanha parada. Voltaram ${txills(r.refunded)} para a carteira.` : 'Campanha parada.' });
          await refresh();
        } catch (e) {
          setMsg({ ok: false, text: (e as Error).message || 'Não deu para parar agora.' });
        }
      })(),
    );
  };

  const nothing = !o.targets.events.length && !o.targets.posts.length;
  if (!rules.buyBoosts) {
    // Nas lojas, com as compras pela loja ligadas (IAP_READY e o catálogo do servidor): os pacotes da loja.
    if (rules.storeBoosts) {
      return (
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <StoreBoost v={v} o={o} target={target} setTarget={setTarget} onDone={refresh} />
          <Campaigns title="Ativas" items={camps.data?.active ?? []} onStop={stop} empty="Nenhuma campanha a bombar agora." />
          <Campaigns title="Passadas" items={camps.data?.past ?? []} empty="Ainda não há campanhas passadas." />
        </View>
      );
    }
    return (
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <View style={st.intro}>
          <Icon name="flame" size={22} color={colors.brand} />
          <Text style={[st.hint, { flex: 1 }]}>Nesta versão da app não se criam campanhas novas do Bombar. Aqui vês as campanhas do local, com o relatório, e podes parar as que estão ativas.</Text>
        </View>
        {msg ? <Text accessibilityRole="alert" style={{ textAlign: 'center', fontSize: 14, color: msg.ok ? colors.green700 : colors.red600 }}>{msg.text}</Text> : null}
        <Campaigns title="Ativas" items={camps.data?.active ?? []} onStop={stop} empty="Nenhuma campanha a bombar agora." />
        <Campaigns title="Passadas" items={camps.data?.past ?? []} empty="Ainda não há campanhas passadas." />
      </View>
    );
  }
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <View style={st.intro}>
        <Icon name="flame" size={22} color={colors.brand} />
        <Text style={[st.hint, { flex: 1 }]}>
          Destaca um evento ou uma publicação do local no feed e no mapa À tua volta de quem está perto. Aparece sempre com a etiqueta “{o.label}”, só a maiores de 18 anos, e cada pessoa vê-o no máximo 3 vezes por dia.
        </Text>
      </View>

      {!o.canBoost ? (
        <View style={st.notice} accessibilityRole="alert">
          <Icon name="info" size={18} color="#b45309" />
          <Text style={st.noticeText}>{o.blocker}</Text>
        </View>
      ) : nothing ? (
        <Text style={[st.hint, { textAlign: 'center', paddingVertical: 8 }]}>Para bombar, cria primeiro um evento (secção Eventos) ou publica como o local.</Text>
      ) : (
        <View style={st.box}>
          <Text style={st.boxTitle}>Nova campanha</Text>

          <Text style={st.label}>O que bombar</Text>
          <TargetPicker o={o} target={target} onPick={setTarget} />

          <Text style={st.label}>Durante quanto tempo</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
            {o.packages.map((p) => {
              const on = pkg === p.id;
              const pr = priceFor(o.packages, p.id, radius);
              return (
                <Pressable key={p.id} onPress={() => setPkg(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${p.label}, ${pr != null ? txills(pr) : ''}`} style={[st.pkg, on && st.pkgOn]}>
                  <Text style={[st.pkgTitle, on && { color: '#fff' }]}>{p.label}</Text>
                  <Text style={[st.pkgPrice, on && { color: '#fff' }]}>{pr != null ? txills(pr) : '…'}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={st.label}>Raio à volta do local</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 6 }}>
              {Array.from({ length: o.radius.max - o.radius.min + 1 }, (_, i) => o.radius.min + i).map((r) => (
                <Pressable key={r} onPress={() => setRadius(r)} accessibilityRole="radio" accessibilityState={{ selected: radius === r }} accessibilityLabel={`${r} quilómetros`} style={[st.km, radius === r && st.kmOn]}>
                  <Text style={[st.kmText, radius === r && { color: '#fff' }]}>{r} km</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Text style={st.small}>O preço inclui até {o.radius.included} km; cada km a mais soma {Math.round(o.radius.extraPerKm * 100)}%.</Text>

          <Text style={st.label}>Pagamento</Text>
          <View style={{ gap: 6 }}>
            <View style={[st.option, st.optionOn]}>
              <Icon name="wallet" size={18} color={colors.zinc900} />
              <Text style={[st.optTitle, { flex: 1 }]}>Txills do local</Text>
              <Text style={st.optSub}>Saldo: {txills(o.balance)}</Text>
            </View>
            {mzn && !mzn.enabled ? (
              <View style={[st.option, { opacity: 0.5 }]} accessibilityState={{ disabled: true }}>
                <Icon name="phone" size={18} color={colors.zinc700} />
                <Text style={[st.optTitle, { flex: 1 }]}>{mzn.label}</Text>
                <Text style={st.optSub}>Brevemente</Text>
              </View>
            ) : null}
          </View>

          <View style={st.total} accessibilityLiveRegion="polite">
            <Text style={st.totalText}>Custa {price != null ? txills(price) : '…'}</Text>
            <Text style={[st.small, short && { color: colors.red600 }]}>{short ? `Faltam ${txills((price ?? 0) - o.balance)} na carteira do local.` : `Ficam ${txills(o.balance - (price ?? 0))}.`}</Text>
          </View>
          <Pressable onPress={submit} disabled={busy || !target || short || price == null} style={[st.cta, (busy || !target || short || price == null) && { opacity: 0.5 }]} accessibilityRole="button">
            <Text style={st.ctaText}>{busy ? 'A bombar…' : price != null ? `Bombar por ${txills(price)}` : 'Bombar'}</Text>
          </Pressable>
          <Text style={st.small}>Pode ser parada a qualquer momento: voltam os dias inteiros que faltam (tudo, se ainda não começou). O local só vê totais, nunca quem viu.</Text>
        </View>
      )}

      {msg ? <Text accessibilityRole="alert" style={{ textAlign: 'center', fontSize: 14, color: msg.ok ? colors.green700 : colors.red600 }}>{msg.text}</Text> : null}

      <Campaigns title="Ativas" items={camps.data?.active ?? []} onStop={stop} empty="Nenhuma campanha a bombar agora." />
      <Campaigns title="Passadas" items={camps.data?.past ?? []} empty="Ainda não há campanhas passadas." />
    </View>
  );
}

/** O evento ou a publicação do local a bombar. */
export function TargetPicker({ o, target, onPick }: { o: BoostOptions; target: { kind: 'event' | 'post'; id: string } | null; onPick: (t: { kind: 'event' | 'post'; id: string }) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
      {o.targets.events.map((e) => {
        const on = target?.kind === 'event' && target.id === e.id;
        return (
          <Pressable key={e.id} onPress={() => onPick({ kind: 'event', id: e.id })} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Evento: ${e.title}, ${eventWhen(e.startsAt, e.endsAt)}`} style={[st.option, on && st.optionOn]}>
            <View style={[st.thumb, { backgroundColor: colors.brand }]}><Icon name="calendar" size={18} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.optTitle} numberOfLines={1}>{e.title}</Text>
              <Text style={st.optSub} numberOfLines={1}>Evento · {eventWhen(e.startsAt, e.endsAt)}</Text>
            </View>
            {on ? <Icon name="check-circle" size={20} color={colors.brand} /> : null}
          </Pressable>
        );
      })}
      {o.targets.posts.map((p) => {
        const on = target?.kind === 'post' && target.id === p.id;
        return (
          <Pressable key={p.id} onPress={() => onPick({ kind: 'post', id: p.id })} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`Publicação: ${p.body || 'sem texto'}`} style={[st.option, on && st.optionOn]}>
            <View style={st.thumb}>
              {p.thumbUrl ? <Image source={{ uri: sized(p.thumbUrl, 120) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="image" size={18} color={colors.zinc500} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.optTitle} numberOfLines={1}>{p.body || 'Publicação sem texto'}</Text>
              <Text style={st.optSub} numberOfLines={1}>Publicação do local · {shortWhen(p.createdAt)}</Text>
            </View>
            {on ? <Icon name="check-circle" size={20} color={colors.brand} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * O Bombar pago pela loja (App Store / Google Play): os pacotes do catálogo (dias e raio fixos) com o preço que a loja
 * mostra. Cria primeiro a campanha em rascunho (`source: 'iap'` e o pacote), abre a compra e manda o verify com o
 * `campaignId`; o servidor ativa a campanha. Se a confirmação falhar, a compra fica guardada e volta a ir ao servidor.
 */
function StoreBoost({ v, o, target, setTarget, onDone }: { v: Venue; o: BoostOptions; target: { kind: 'event' | 'post'; id: string } | null; setTarget: (t: { kind: 'event' | 'post'; id: string }) => void; onDone: () => Promise<unknown> }) {
  const catalog = useIapCatalog();
  const packs = catalog.data?.boost.products ?? [];
  const ids = packs.map((p) => p.id).join(',');
  const [prices, setPrices] = useState<StoreProduct[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // A mesma chave até o rascunho ficar pago: tocar outra vez depois de uma falha não cria outro rascunho.
  const key = useRef(newKey());

  useEffect(() => {
    if (!ids) return;
    let gone = false;
    void iap.recover().catch(() => undefined);
    iap.products(ids.split(','), 'in-app').then(
      (list) => {
        if (gone) return;
        setPrices(list);
        setPick((p) => p ?? list[0]?.id ?? null);
      },
      () => !gone && setPrices([]),
    );
    return () => {
      gone = true;
    };
  }, [ids]);

  const store = storeName(IAP_PLATFORM ?? 'android');
  const pack = packs.find((p) => p.id === pick);
  const price = prices?.find((p) => p.id === pick)?.price;
  const nothing = !o.targets.events.length && !o.targets.posts.length;

  const show = (r: IapOutcome) => {
    if (r.status === 'done') setMsg({ ok: true, text: 'Está a bombar! A campanha já aparece em Ativas.' });
    else if (r.status === 'cancelled') setMsg(null);
    else {
      const text = iapMessage(r.status === 'error' ? r.kind : r.status);
      setMsg(text ? { ok: r.status === 'pending', text } : null);
    }
  };

  const buy = async () => {
    if (!target || !pack || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await iap.buyBoost(pack.id, () =>
      boostsApi
        .create(v.slug, { target, package: boostPackageFor(pack.days), radiusKm: pack.radiusKm, source: 'iap', pack: pack.id, idempotencyKey: key.current })
        .then((x) => x.campaign),
    );
    if (r.status === 'done') key.current = newKey();
    show(r);
    await onDone();
    setBusy(false);
  };

  return (
    <>
      <View style={st.intro}>
        <Icon name="flame" size={22} color={colors.brand} />
        <Text style={[st.hint, { flex: 1 }]}>
          Destaca um evento ou uma publicação do local no feed e no mapa À tua volta de quem está perto. Aparece sempre com a etiqueta “{o.label}”, só a maiores de 18 anos, e cada pessoa vê-o no máximo 3 vezes por dia. Pagas pela {store}.
        </Text>
      </View>
      {!o.canBoost ? (
        <View style={st.notice} accessibilityRole="alert">
          <Icon name="info" size={18} color="#b45309" />
          <Text style={st.noticeText}>{o.blocker}</Text>
        </View>
      ) : nothing ? (
        <Text style={[st.hint, { textAlign: 'center', paddingVertical: 8 }]}>Para bombar, cria primeiro um evento (secção Eventos) ou publica como o local.</Text>
      ) : (
        <View style={st.box}>
          <Text style={st.boxTitle}>Nova campanha</Text>
          <Text style={st.label}>O que bombar</Text>
          <TargetPicker o={o} target={target} onPick={setTarget} />
          <Text style={st.label}>Pacote</Text>
          {prices == null ? <PontoLoader size={18} /> : null}
          {prices && !prices.length ? <Text style={st.hint}>A {store} não mostrou os pacotes agora. Tenta outra vez daqui a pouco.</Text> : null}
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {packs.filter((p) => prices?.some((x) => x.id === p.id)).map((p) => {
              const on = pick === p.id;
              const pr = prices?.find((x) => x.id === p.id)?.price ?? '';
              return (
                <Pressable key={p.id} onPress={() => setPick(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${boostPackLabel(p)}, ${pr}`} style={[st.option, on && st.optionOn]}>
                  <Text style={[st.optTitle, { flex: 1 }]}>{boostPackLabel(p)}</Text>
                  <Text style={st.optTitle}>{pr}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => void buy()} disabled={busy || !target || !pack || !price} style={[st.cta, (busy || !target || !pack || !price) && { opacity: 0.5 }]} accessibilityRole="button">
            <Text style={st.ctaText}>{busy ? 'A bombar…' : price ? `Bombar por ${price}` : 'Bombar'}</Text>
          </Pressable>
          <Text style={st.small}>Pagas pela {store}, ao preço que ela mostra, e a campanha começa logo que a compra for confirmada. O local só vê totais, nunca quem viu.</Text>
        </View>
      )}
      {msg ? <Text accessibilityRole="alert" style={{ textAlign: 'center', fontSize: 14, color: msg.ok ? colors.green700 : colors.red600 }}>{msg.text}</Text> : null}
    </>
  );
}

function Campaigns({ title, items, onStop, empty }: { title: string; items: BoostCampaign[]; onStop?: (c: BoostCampaign) => void; empty: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={st.label}>{title}</Text>
      {items.length ? items.map((c) => <CampaignCard key={c.id} c={c} onStop={onStop} />) : <Text style={st.hint}>{empty}</Text>}
    </View>
  );
}

function CampaignCard({ c, onStop }: { c: BoostCampaign; onStop?: (c: BoostCampaign) => void }) {
  const live = c.state === 'active' || c.state === 'scheduled';
  return (
    <View style={st.camp}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={c.target.kind === 'event' ? 'calendar' : 'image'} size={18} color={colors.zinc800} />
        <Text style={[st.optTitle, { flex: 1 }]} numberOfLines={1}>{c.target.title}</Text>
        <View style={[st.badge, live && { backgroundColor: colors.rose50 }]}>
          <Text style={[st.badgeText, live && { color: colors.brand }]}>{STATE_LABEL[c.state]}</Text>
        </View>
      </View>
      <Text style={st.optSub}>
        {shortWhen(c.startsAt)} → {shortWhen(c.stoppedAt ?? c.endsAt)} · {c.radiusKm} km · {txills(c.price)}{c.refunded ? ` (devolvidos ${txills(c.refunded)})` : ''}
      </Text>
      {c.note ? <Text style={[st.optSub, { color: '#b45309' }]}>Nota da equipa: {c.note}</Text> : null}
      <View style={st.stats}>
        {reportLines(c.report).map((l) => (
          <View key={l.label} style={st.stat} accessible accessibilityLabel={`${l.label}: ${l.value}`}>
            <Text style={st.statValue}>{l.value.toLocaleString('pt-PT')}</Text>
            <Text style={st.statLabel}>{l.label}</Text>
          </View>
        ))}
      </View>
      {live && onStop ? (
        <Pressable onPress={() => onStop(c)} style={st.stop} accessibilityRole="button" accessibilityLabel={`Parar a campanha de ${c.target.title}`}>
          <Text style={st.stopText}>Parar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  intro: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 16, backgroundColor: colors.rose50, padding: 14 },
  hint: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  small: { fontSize: 12, lineHeight: 17, color: colors.zinc500 },
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: 16, backgroundColor: '#fffbeb', padding: 14 },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#78350f' },
  box: { gap: 10, borderRadius: 20, backgroundColor: '#fafafa', padding: 14 },
  boxTitle: { fontSize: 17, fontWeight: '800', color: colors.zinc900 },
  label: { marginTop: 6, fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.5 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: colors.white, padding: 10, borderWidth: 2, borderColor: 'transparent' },
  optionOn: { borderColor: colors.brand },
  thumb: { width: 40, height: 40, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  optSub: { fontSize: 13, color: colors.zinc500 },
  pkg: { flex: 1, borderRadius: 14, backgroundColor: colors.white, paddingVertical: 10, alignItems: 'center', gap: 2 },
  pkgOn: { backgroundColor: colors.zinc900 },
  pkgTitle: { fontSize: 15, fontWeight: '800', color: colors.zinc900 },
  pkgPrice: { fontSize: 12, fontWeight: '600', color: colors.zinc600 },
  km: { height: 36, minWidth: 52, borderRadius: 999, paddingHorizontal: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  kmOn: { backgroundColor: colors.zinc900 },
  kmText: { fontSize: 14, fontWeight: '700', color: colors.zinc800 },
  total: { marginTop: 4, gap: 2 },
  totalText: { fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  cta: { height: 48, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  camp: { gap: 8, borderRadius: 16, backgroundColor: '#fafafa', padding: 12 },
  badge: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.zinc700 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stat: { flexBasis: '31%', flexGrow: 1, borderRadius: 12, backgroundColor: colors.white, padding: 8 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  statLabel: { fontSize: 11, color: colors.zinc600 },
  stop: { alignSelf: 'flex-start', height: 36, borderRadius: 999, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  stopText: { fontSize: 14, fontWeight: '700', color: colors.red600 },
});
