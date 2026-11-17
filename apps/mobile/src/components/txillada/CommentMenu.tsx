import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { Sheet } from '@/components/Sheet';
import { ActionRow } from '@/components/ui/ActionRow';
import { colors, dark as D } from '@/lib/theme';
import { commentCheersLabel, type CommentMenuItem, type TxilladaComment } from '@/lib/txillada';
import { PinIcon } from './PinnedComment';

const ROWS: Record<CommentMenuItem, { icon: IconName | 'pin'; danger?: boolean }> = {
  reply: { icon: 'reply' },
  cheer: { icon: 'cheers' },
  pin: { icon: 'pin' },
  unpin: { icon: 'pin' },
  remove: { icon: 'trash', danger: true },
  ban: { icon: 'block', danger: true },
  report: { icon: 'flag', danger: true },
};

/** O texto de cada linha do menu. */
export function commentMenuLabel(item: CommentMenuItem, c: TxilladaComment): string {
  switch (item) {
    case 'reply': return `Responder a @${c.author.username}`;
    case 'cheer': return c.cheered ? 'Já brindaste' : 'Brindar';
    case 'pin': return 'Fixar comentário';
    case 'unpin': return 'Tirar o fixado';
    case 'remove': return 'Apagar';
    case 'ban': return `Expulsar @${c.author.username}`;
    case 'report': return 'Denunciar comentário';
  }
}

/**
 * O menu de um comentário da Txillada: a mesma folha escura do «⋯» (Sheet `dark`, por cima do vídeo), com o comentário em
 * cima (a roda da foto, o @ com o selo, o texto e os brindes) e as ações por baixo (ActionRow): primeiro as outras, depois
 * as que tiram (apagar, expulsar, denunciar) a vermelho. Tocar fora, arrastar para baixo ou «Cancelar» fecha.
 */
export function CommentMenu({ c, items, onPick, onClose }: {
  c: TxilladaComment; items: readonly CommentMenuItem[];
  onPick: (item: CommentMenuItem) => void; onClose: () => void;
}) {
  const cheers = commentCheersLabel(c.cheers);
  const ordered = [...items.filter((i) => !ROWS[i].danger), ...items.filter((i) => ROWS[i].danger)];

  return (
    <Sheet onClose={onClose} dark cancel>
      <View style={st.wrap}>
        <View style={st.head}>
          <View style={st.ring}>
            <Avatar name={c.author.displayName} username={c.author.avatarUrl ? c.author.username : undefined} size={36} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <NameWithBadge name={c.author.username} who={c.author} style={st.name}>
              {cheers ? (
                <View style={st.cheersRow}>
                  <Icon name="cheers" size={13} color={D.sub} strokeWidth={2.2} />
                  <Text style={st.cheers}>{cheers}</Text>
                </View>
              ) : null}
            </NameWithBadge>
            <Text style={st.body} numberOfLines={3}>{c.body}</Text>
          </View>
        </View>
        {ordered.map((item) => {
          const r = ROWS[item];
          const off = item === 'cheer' && !!c.cheered;
          return (
            <ActionRow
              key={item}
              icon={r.icon === 'pin' ? <PinIcon size={20} color={D.text} strokeWidth={2} /> : r.icon}
              title={commentMenuLabel(item, c)}
              danger={r.danger}
              disabled={off}
              onPress={() => onPick(item)}
              right={off ? <Icon name="check" size={17} color={colors.brandWarm} strokeWidth={2.6} /> : undefined}
            />
          );
        })}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 20 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingHorizontal: 4, paddingBottom: 12, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: D.line },
  ring: { borderRadius: 999, padding: 1.5, borderWidth: 2, borderColor: colors.brand },
  name: { flexShrink: 1, color: D.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  cheersRow: { marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  cheers: { color: D.sub, fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { marginTop: 2, color: 'rgba(255,255,255,0.86)', fontSize: 14.5, lineHeight: 20 },
});
