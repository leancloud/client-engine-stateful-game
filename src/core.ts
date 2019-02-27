import { Player } from "@leancloud/play";
import { Action as ReduxAction, AnyAction, Store } from "redux";

/** 运行环境 */
export enum Env {
  SERVER,
  CLIENT
}

/** 客户端与服务端通过 Play 的 customEvent 通讯时使用的 EventId */
export enum ProtocalEvent {
  /** 客户端派发事件 */
  EVENT = "_event",
  /** 状态更新 */
  UPDATE = "_update"
}

/** 事件上下文 */
export interface IEventContext {
  /** 游戏玩家列表（不包括 masterClient 的 playerList） */
  players: Player[];
  /** 派发该事件的玩家，`undefined` 意味着该事件是服务端派发的 */
  emitter?: Player;
  /** 当前处理事件的运行环境（事件处理方法可能会同时在服务端与客户端执行） */
  env: Env;
  /** 派发事件的运行环境 */
  emitterEnv: Env;
}

export type Destructible<T> = T extends { [key: string]: any } ? T : {};

export type GameEvent<
  name extends string | number | symbol,
  Payload
> = Destructible<Payload> &
  IEventContext & {
    type: name;
    payload: Payload;
  };

declare type EventPayloadMap<T> = { [K in keyof T]: GameEvent<K, T[K]> };
export type GameEventType<Payloads extends object> = EventPayloadMap<
  Payloads
>[keyof Payloads];

type Handler<StateOperator, name extends string | number | symbol, Payload> = (
  /** 可用的操作 */
  operator: StateOperator,
  /** 事件 */
  event: GameEvent<name, Payload>
) => any;

/** 事件有效载荷 */
export type EventPayloads<Event extends string | number> = {
  [name in Event]?: any
};

/** 可用的操作 */
interface IStateOperator<
  State,
  Event extends string | number,
  EP extends EventPayloads<Event>
> {
  /** 获取当前的状态 */
  getState: () => State;
  /** 更新状态，新的状态会 merge 到当前的状态中 */
  setState: (state: Partial<State>) => void;
  /** 派发事件 */
  emitEvent: <N extends Event>(
    name: N,
    payload?: EP[N],
    options?: {
      emitter?: Player;
    }
  ) => any;
}

/** 事件处理器 */
export type EventHandlers<
  State,
  Event extends string | number,
  Payloads extends EventPayloads<Event>
> = {
  [name in Event]?: Handler<
    IStateOperator<State, Event, Payloads>,
    name,
    Payloads[name]
  >
};

/** ReduxGame 事件可用的操作 */
interface IReduxStateOperator<
  State,
  E extends string | number,
  EP extends EventPayloads<E>,
  Action extends ReduxAction
> {
  /** 获取当前的状态 */
  getState: () => State;
  /** 派发 action */
  dispatch: Store<State, Action>["dispatch"];
  /** 派发事件 */
  emitEvent: <N extends E>(
    name: N,
    payload?: EP[N],
    options?: {
      emitter?: Player;
    }
  ) => any;
}

/** ReduxGame 事件处理器 */
export type ReduxEventHandlers<
  State,
  Event extends string | number,
  Payloads extends EventPayloads<Event> = {},
  Action extends ReduxAction = AnyAction
> = {
  [name in Event]?: Handler<
    IReduxStateOperator<State, Event, Payloads, Action>,
    name,
    Payloads[name]
  >
};

/**
 * 限制某个事件的处理方法只在服务端运行，该方法传入一个事件处理方法，返回一个新的事件处理方法。
 */
export function serverOnly<StateOperator, name extends string | number | symbol, P>(
  handler: Handler<StateOperator, name, P>
): Handler<StateOperator, name, P> {
  return (operator, event) => {
    if (event.env !== Env.SERVER) {
      return;
    }
    return handler(operator, event);
  };
}

/**
 * 限制某个事件的处理方法只在由服务端派发时运行，该方法传入一个事件处理方法，返回一个新的事件处理方法。
 */
export function fromServerOnly<StateOperator, name extends string | number | symbol, P>(
  handler: Handler<StateOperator, name, P>
): Handler<StateOperator, name, P> {
  return (operator, event) => {
    if (event.emitterEnv !== Env.SERVER) {
      return;
    }
    return handler(operator, event);
  };
}
