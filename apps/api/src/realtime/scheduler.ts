import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import client from 'prom-client';
import { runsBackground } from '../common/role';
import { AppConfig, CONFIG } from '../config';
import { registry } from '../observability/metrics';

export interface TaskOptions {
  /** A primeira vez: ao fim de quanto tempo (0 = já). Sem isto, só ao fim do primeiro intervalo. */
  firstAfterMs?: number;
  /** Também corre com NODE_ENV=test (por omissão não: os testes chamam as tarefas à mão). */
  inTests?: boolean;
}

const runs = new client.Counter({ name: 'periodic_task_runs_total', help: 'Execuções das tarefas periódicas', labelNames: ['task', 'result'] as const, registers: [registry] });

/**
 * As tarefas periódicas e de arranque do servidor (limpezas, lembretes, a sexta da gelada, o nível da geleira…), num sítio só.
 * Correm apenas onde há trabalho de fundo: no worker (ROLE=worker) ou sem ROLE (uma instância só); nas instâncias
 * ROLE=web nunca (senão corriam N vezes). Nos testes só as marcadas com `inTests` (as que já corriam antes).
 * Uma tarefa não se sobrepõe a ela própria: se a anterior ainda está a correr, esta volta salta.
 */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Tarefas');
  /** Se este processo corre trabalho de fundo (o papel). */
  readonly runsHere: boolean;
  private readonly test: boolean;
  private readonly tasks = new Map<string, { everyMs: number | null; active: boolean }>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly busy = new Set<string>();
  private stopped = false;
  private readonly role: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.runsHere = runsBackground(config);
    this.test = config.NODE_ENV === 'test';
    this.role = config.ROLE ?? 'api (sem ROLE)';
  }

  /** No arranque, diz o que ficou a correr neste processo (nos registos do contentor). */
  onApplicationBootstrap() {
    if (this.test) return;
    const here = this.planned();
    this.log.log(`papel ${this.role}: ${here.length ? `${here.length} tarefas de fundo (${here.join(', ')})` : 'sem tarefas de fundo'}`);
  }

  private allowed(opts: TaskOptions) {
    return this.runsHere && !this.stopped && (!this.test || !!opts.inTests);
  }

  /** De `everyMs` em `everyMs`. Devolve true se fica a correr neste processo. */
  every(name: string, everyMs: number, fn: () => unknown, opts: TaskOptions = {}): boolean {
    const active = this.allowed(opts);
    this.tasks.set(name, { everyMs, active });
    if (!active) return false;
    const t = setInterval(() => this.run(name, fn), everyMs);
    t.unref();
    this.timers.add(t);
    if (opts.firstAfterMs !== undefined) this.later(name, opts.firstAfterMs, fn);
    return true;
  }

  /** Uma vez, ao fim de `afterMs` (0 = já): os trabalhos de arranque (miniaturas, temas e sons antigos…). */
  once(name: string, afterMs: number, fn: () => unknown, opts: TaskOptions = {}): boolean {
    const active = this.allowed(opts);
    if (!this.tasks.has(name)) this.tasks.set(name, { everyMs: null, active });
    if (!active) return false;
    this.later(name, afterMs, fn);
    return true;
  }

  private later(name: string, ms: number, fn: () => unknown) {
    if (ms <= 0) return void this.run(name, fn);
    const t = setTimeout(() => {
      this.timers.delete(t);
      void this.run(name, fn);
    }, ms);
    t.unref();
    this.timers.add(t);
  }

  private async run(name: string, fn: () => unknown) {
    if (this.stopped || this.busy.has(name)) return;
    this.busy.add(name);
    try {
      await fn();
      runs.inc({ task: name, result: 'ok' });
    } catch (e) {
      runs.inc({ task: name, result: 'error' });
      this.log.warn(`${name}: ${(e as Error).message}`);
    } finally {
      this.busy.delete(name);
    }
  }

  /** As tarefas registadas e se correm aqui (para os testes e para o arranque dizer o que ficou ligado). */
  list(): { name: string; everyMs: number | null; active: boolean }[] {
    return [...this.tasks.entries()].map(([name, t]) => ({ name, ...t }));
  }

  /** Os nomes das tarefas que correm neste processo. */
  planned(): string[] {
    return this.list().filter((t) => t.active).map((t) => t.name);
  }

  onModuleDestroy() {
    this.stopped = true;
    for (const t of this.timers) {
      clearInterval(t);
      clearTimeout(t);
    }
    this.timers.clear();
  }
}
