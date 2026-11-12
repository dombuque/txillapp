import { Platform, type ShareContent } from 'react-native';
import { linkSharePlan } from './shareLinkPlan';

/** A ligação vai uma só vez: à parte no iPhone e no browser, no fim do texto no Android (ver linkSharePlan). */
export const linkShare = (text: string, url: string): ShareContent => linkSharePlan(Platform.OS, text, url);
