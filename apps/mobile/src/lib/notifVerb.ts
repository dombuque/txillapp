/**
 * Verbos da 1.ª conjugação no pretérito, para as linhas das notificações: uma pessoa "comentou", várias "comentaram".
 * Antes juntava-se "u"/"ram" a "comento", e com várias pessoas saía "comentoram", "repostoram", "identificoram-te".
 * `stem` é o radical sem a terminação: "coment", "aceit", "repost", "identific", "mencion".
 */
export function pastVerb(stem: string, many: boolean): string {
  return `${stem}${many ? 'aram' : 'ou'}`;
}
