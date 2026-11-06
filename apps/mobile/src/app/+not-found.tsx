import { Redirect } from 'expo-router';

/** Endereço que não existe (links antigos, erros de escrita): volta ao início, como o site antigo fazia. */
export default function NotFound() {
  return <Redirect href="/" />;
}
