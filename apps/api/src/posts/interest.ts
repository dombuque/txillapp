/**
 * O perfil de temas de uma pessoa (o interesse do Explorar e dos Reels, e a base do Mixar): os temas do que brindou,
 * comentou e guardou, das contas que segue, do «interessado / não interessado» e, com `prefs`, das preferências por tema
 * («mais / menos» no Explorar), cada um com o seu peso. Devolve as linhas (topic, wt), já somadas por tema.
 *
 * @param user placeholder do id da pessoa (por omissão $1)
 * @param prefs conta as preferências por tema (o Explorar e o Mixar sim; «o que o algoritmo aprendeu contigo» não)
 */
export const interestSql = (user = '$1', prefs = true) => `
  SELECT topic, sum(wt) AS wt FROM (
    SELECT unnest(p.topics) AS topic, 1.0 AS wt FROM content.cheers c JOIN content.posts p ON p.id = c.post_id WHERE c.user_id = ${user} AND c.created_at > now() - interval '60 days' AND p.topics IS NOT NULL
    UNION ALL SELECT unnest(p.topics), 2.0 FROM content.comments c JOIN content.posts p ON p.id = c.post_id WHERE c.author_id = ${user} AND c.created_at > now() - interval '60 days' AND p.topics IS NOT NULL
    UNION ALL SELECT unnest(p.topics), 3.0 FROM content.saved_posts s JOIN content.posts p ON p.id = s.post_id WHERE s.user_id = ${user} AND p.topics IS NOT NULL
    UNION ALL SELECT unnest(p.topics), 0.4 FROM social.follows f JOIN content.posts p ON p.author_id = f.followee_id AND p.created_at > now() - interval '30 days' WHERE f.follower_id = ${user} AND p.topics IS NOT NULL
    UNION ALL SELECT unnest(p.topics), 2.5 * fb.value FROM content.post_feedback fb JOIN content.posts p ON p.id = fb.post_id WHERE fb.user_id = ${user} AND p.topics IS NOT NULL
    ${prefs ? `UNION ALL SELECT topic, 8.0 * pref FROM social.explore_prefs WHERE user_id = ${user}` : ''}
  ) x GROUP BY topic`;
