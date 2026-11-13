import type { AppConfig } from '../config';
import { Scheduler } from './scheduler';

/** As tarefas periódicas só correm onde há trabalho de fundo: no worker ou sem ROLE (docs/escala.md). */
const make = (ROLE: AppConfig['ROLE'], NODE_ENV: AppConfig['NODE_ENV'] = 'production') => new Scheduler({ ROLE, NODE_ENV } as AppConfig);

describe('Scheduler (tarefas periódicas)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('ROLE=web: nenhuma tarefa corre, nem a do arranque', async () => {
    const s = make('web');
    const fn = jest.fn();
    expect(s.every('a', 1000, fn, { firstAfterMs: 0 })).toBe(false);
    expect(s.once('b', 10, fn)).toBe(false);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(fn).not.toHaveBeenCalled();
    expect(s.planned()).toEqual([]);
    expect(s.list().map((t) => t.name)).toEqual(['a', 'b']);
    s.onModuleDestroy();
  });

  it('ROLE=worker: corre de intervalo a intervalo, a primeira quando pedida, e para no fim', async () => {
    const s = make('worker');
    const every = jest.fn();
    const first = jest.fn();
    const boot = jest.fn();
    expect(s.every('every', 1000, every)).toBe(true);
    expect(s.every('first', 1000, first, { firstAfterMs: 0 })).toBe(true);
    expect(s.once('boot', 500, boot)).toBe(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(every).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(every).toHaveBeenCalledTimes(3);
    expect(first).toHaveBeenCalledTimes(4);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(s.planned().sort()).toEqual(['boot', 'every', 'first']);
    s.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(every).toHaveBeenCalledTimes(3);
  });

  it('sem ROLE: corre tudo, como uma instância só', async () => {
    const s = make(undefined);
    const fn = jest.fn();
    s.every('x', 1000, fn);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    s.onModuleDestroy();
  });

  it('nos testes (NODE_ENV=test) só as marcadas com inTests', async () => {
    const s = make(undefined, 'test');
    const normal = jest.fn();
    const always = jest.fn();
    s.every('normal', 1000, normal, { firstAfterMs: 0 });
    s.every('always', 1000, always, { firstAfterMs: 0, inTests: true });
    await jest.advanceTimersByTimeAsync(1000);
    expect(normal).not.toHaveBeenCalled();
    expect(always).toHaveBeenCalledTimes(2);
    s.onModuleDestroy();
  });

  it('uma tarefa não se sobrepõe a ela própria e um erro não a desliga', async () => {
    const s = make('worker');
    let running = 0;
    let max = 0;
    let calls = 0;
    s.every('lenta', 100, async () => {
      calls++;
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 250));
      running--;
      if (calls === 1) throw new Error('falhou uma vez');
    });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(max).toBe(1);
    expect(calls).toBeGreaterThanOrEqual(3);
    s.onModuleDestroy();
  });
});
