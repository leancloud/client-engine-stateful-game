import { Player } from "@leancloud/play";
import { Action as ReduxAction, AnyAction, Store } from "redux";

export enum Env {
  SERVER,
  CLIENT,
}

export interface IEventContext {
  players: Player[];
  emitter?: Player;
  env: Env;
  emitterEnv: Env;
}

type Handler<StateOperator, Context, Payload> = (
  stateOperator: StateOperator,
  context: Context,
  payload: Payload,
) => any;

export type EventPayloads<Event extends string | number> = { [name in Event]?: any };

interface IStateOperator<State, E extends string | number, EP extends EventPayloads<E>> {
  getState: () => State;
  setState: (state: Partial<State>) => void;
  emitEvent: <N extends E>(name: N, payload?: EP[N], options?: {
    emitter?: Player,
  }) => any;
}

export type EventHandlers<
  State,
  Event extends string | number,
  Payloads extends EventPayloads<Event> = {},
> = {
  [name in Event]?: Handler<IStateOperator<State, Event, Payloads>, IEventContext, Payloads[name]>
};

interface IReduxStateOperator<
  State,
  E extends string | number,
  EP extends EventPayloads<E>,
  Action extends ReduxAction,
> {
  getState: () => State;
  dispatch: Store<State, Action>["dispatch"];
  emitEvent: <N extends E>(name: N, payload?: EP[N], options?: {
    emitter?: Player,
  }) => any;
}

export type ReduxEventHandlers<
  State,
  Event extends string | number,
  Payloads extends EventPayloads<Event> = {},
  Action extends ReduxAction = AnyAction,
> = {
  [name in Event]?: Handler<IReduxStateOperator<State, Event, Payloads, Action>, IEventContext, Payloads[name]>
};

export function serverOnly<StateOperator, C extends { env: Env }, P>(
  handler: Handler<StateOperator, C, P>,
): Handler<StateOperator, C, P> {
  return (
    stateOperator: StateOperator,
    context: C,
    payload: P,
  ) => {
    if (context.env !== Env.SERVER) { return; }
    return handler(stateOperator, context, payload);
  };
}

export function fromServerOnly<StateOperator, C extends { emitterEnv: Env }, P>(
  handler: Handler<StateOperator, C, P>,
): Handler<StateOperator, C, P> {
  return (
    stateOperator: StateOperator,
    context: C,
    payload: P,
  ) => {
    if (context.emitterEnv !== Env.SERVER) { return; }
    return handler(stateOperator, context, payload);
  };
}
