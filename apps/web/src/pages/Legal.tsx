import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MIN_AGE, TERMS_VERSION } from '@txillapp/shared';
import { BackIcon } from '../components/icons';
import { Wordmark } from '../components/ui';

function Page({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-white px-5 pb-16">
      <header className="sticky top-0 z-10 -mx-5 flex items-center gap-2 border-b border-zinc-100 bg-white/95 px-3 py-2 backdrop-blur">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }))} aria-label="Voltar" className="flex h-11 w-11 items-center justify-center rounded-full active:bg-zinc-100">
          <BackIcon />
        </button>
        <Wordmark className="h-7" />
      </header>
      <h1 className="mt-6 text-3xl font-extrabold">{title}</h1>
      <p className="mt-1 text-sm text-zinc-500">Versão {TERMS_VERSION}</p>
      <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-zinc-700">
        Documento de trabalho em linguagem simples. Antes do lançamento público deve ser revisto por um advogado e completado com os dados da entidade responsável.
      </p>
      <div className="mt-6 space-y-6 text-[16px] leading-relaxed text-zinc-800 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
      <p className="mt-10 text-center text-sm text-zinc-500">
        <Link to="/terms" className="underline">Termos de Uso</Link> · <Link to="/privacy" className="underline">Política de Privacidade</Link>
      </p>
    </div>
  );
}

export function Terms() {
  return (
    <Page title="Termos de Uso">
      <section>
        <h2>1. O que é o Txillapp</h2>
        <p>
          O Txillapp é uma rede social: publicas fotos e textos, segues pessoas, partilhas stories e trocas mensagens. Inclui uma carteira de <b>Txills, uma moeda fictícia de demonstração</b>:
          não tem valor em dinheiro, não se compra, não se vende e não se levanta.
        </p>
      </section>
      <section>
        <h2>2. Quem pode ter conta</h2>
        <ul>
          <li>Tens de ter pelo menos {MIN_AGE} anos.</li>
          <li>Uma pessoa, uma conta. Dá informação verdadeira e mantém a tua senha em segredo.</li>
          <li>Podemos pedir-te para confirmar a idade e suspender contas que não cumpram este mínimo.</li>
        </ul>
      </section>
      <section>
        <h2>3. O que publicas é teu — e é da tua responsabilidade</h2>
        <p>
          Continuas dono do que publicas. Ao publicar, dás-nos permissão para guardar e mostrar esse conteúdo às pessoas que escolheste (segundo as tuas definições de privacidade),
          só para o serviço funcionar. Só publiques o que tens direito de partilhar.
        </p>
      </section>
      <section>
        <h2>4. Regras da malta</h2>
        <p>Não é permitido:</p>
        <ul>
          <li>assediar, ameaçar, humilhar ou perseguir pessoas;</li>
          <li>discriminar por raça, género, religião, orientação, origem, deficiência ou outra característica;</li>
          <li>publicar nudez de menores, violência explícita, ou conteúdo ilegal;</li>
          <li>fazer-te passar por outra pessoa, ou enganar com contas falsas, spam ou burlas;</li>
          <li>partilhar dados privados de outras pessoas sem consentimento;</li>
          <li>tentar invadir o serviço, contornar a segurança ou recolher dados em massa.</li>
        </ul>
      </section>
      <section>
        <h2>5. Denúncias e moderação</h2>
        <p>
          Podes denunciar publicações, comentários, mensagens e contas. Analisamos as denúncias e podemos remover conteúdo ou suspender contas que violem estes termos.
          Podes bloquear qualquer pessoa a qualquer momento.
        </p>
      </section>
      <section>
        <h2>6. Terminar a conta</h2>
        <p>
          Podes eliminar a tua conta nas Definições. O teu perfil e as tuas publicações deixam de ser visíveis e os teus dados pessoais são removidos,
          como explicado na Política de Privacidade. Podemos suspender ou encerrar contas que violem estes termos.
        </p>
      </section>
      <section>
        <h2>7. Sem garantias absolutas</h2>
        <p>
          Este serviço é fornecido «como está» e pode ter interrupções ou erros. Na medida permitida pela lei, não nos responsabilizamos por perdas indiretas resultantes do uso do serviço
          ou de conteúdo publicado por outras pessoas.
        </p>
      </section>
      <section>
        <h2>8. Alterações</h2>
        <p>Se mudarmos estes termos de forma relevante, avisamos-te na app e pedimos-te para aceitar de novo.</p>
      </section>
      <section>
        <h2>9. Contacto</h2>
        <p>[Entidade responsável e contacto a preencher antes do lançamento]</p>
      </section>
    </Page>
  );
}

export function Privacy() {
  return (
    <Page title="Política de Privacidade">
      <section>
        <h2>1. Que dados recolhemos</h2>
        <ul>
          <li><b>Conta:</b> nome, @utilizador, email, senha (guardada só em forma cifrada), data de nascimento (só para validar a idade, nunca é mostrada) e, se quiseres, género.</li>
          <li><b>O que publicas:</b> posts, fotos, stories, comentários, brindes, mensagens e as pessoas que identificas ou mencionas.</li>
          <li><b>Localização:</b> só o <i>nome do sítio</i> que escolheres. Nunca guardamos a tua posição exata.</li>
          <li><b>Segurança:</b> sessões e dispositivos com sessão iniciada (tipo de browser, datas de acesso) e registos de ações sensíveis.</li>
          <li><b>Carteira de demonstração:</b> movimentos de Txills fictícios.</li>
          <li><b>Utilização:</b> aberturas da app, ecrãs vistos, desempenho e erros. São estatísticas nossas, sem terceiros, e podes desligá-las em Definições → «Ajudar a melhorar o Txillapp». Também guardamos o que já viste no feed, para não repetir sempre o mesmo.</li>
          <li><b>Fotos e vídeos:</b> são verificados automaticamente no nosso servidor (nudez e conteúdo sexual) antes de ficarem visíveis. Nada é enviado a terceiros.</li>
        </ul>
      </section>
      <section>
        <h2>2. Para que usamos</h2>
        <p>Para fazer o serviço funcionar, mostrar o teu conteúdo a quem escolheste, manter a conta segura, prevenir abuso e analisar denúncias. Não vendemos os teus dados.</p>
      </section>
      <section>
        <h2>3. Quem vê o quê</h2>
        <p>
          Tu controlas: perfil público ou privado, quem comenta, menciona, presenteia ou te envia mensagens, quem vê os teus seguidores e quem repostou, brindou ou presenteou.
          O género só aparece no perfil se tu quiseres. As mensagens diretas só são visíveis para as duas pessoas da conversa.
        </p>
      </section>
      <section>
        <h2>4. Cookies e armazenamento</h2>
        <p>
          Usamos apenas o essencial: um cookie de sessão seguro (para manteres a sessão iniciada) e armazenamento local no teu aparelho (por exemplo, rascunhos de publicações).
          Não usamos cookies de publicidade.
        </p>
      </section>
      <section>
        <h2>5. Quanto tempo guardamos</h2>
        <p>
          Enquanto a conta existir. Ao eliminares a conta, os dados pessoais são removidos ou anonimizados e as tuas fotos e mensagens deixam de estar acessíveis.
          Alguns registos de segurança podem ser mantidos por um período limitado para prevenir abuso.
        </p>
      </section>
      <section>
        <h2>6. Os teus direitos</h2>
        <ul>
          <li><b>Aceder e levar contigo:</b> Definições → «Descarregar os meus dados».</li>
          <li><b>Corrigir:</b> edita o teu perfil a qualquer momento.</li>
          <li><b>Apagar:</b> Definições → «Eliminar conta».</li>
          <li><b>Retirar permissões:</b> podes desligar a localização, câmara e microfone no teu browser.</li>
        </ul>
      </section>
      <section>
        <h2>7. Crianças</h2>
        <p>O Txillapp não é para menores de {MIN_AGE} anos. Se descobrirmos uma conta abaixo dessa idade, removemo-la.</p>
      </section>
      <section>
        <h2>8. Contacto</h2>
        <p>[Responsável pelo tratamento de dados e contacto a preencher antes do lançamento]</p>
      </section>
    </Page>
  );
}
