import { Game } from "@leancloud/client-engine";
import { Play, Player, Room } from "@leancloud/play";
import d = require("debug");
import { pick } from "lodash";
import { debounce } from "lodash-decorators";
import {
  Action as ReduxAction,
  createStore,
  Dispatch,
  Reducer,
  Store
} from "redux";
import { interpret, StateMachine, StateSchema } from "xstate";
import {
  Env,
  EventHandlers,
  EventPayloads,
  GameEvent,
  GameEventType,
  ProtocalEvent,
  ReduxEventHandlers
} from "./core";

/** @ignore */
const debug = d("StatefulGame:Server");

export abstract class StatefulGameBase<
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends Game {
  /** 游戏状态 */
  protected abstract get state(): State;

  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  protected abstract filter: (state: State, player: Player) => State;

  constructor(room: Room, masterClient: Play) {
    super(room, masterClient);
    this.getStream(ProtocalEvent.EVENT).subscribe(
      ({ eventData: { name, payload }, senderId }) =>
        this.internalEmitEvent(
          name,
          payload,
          Env.CLIENT,
          room.getPlayer(senderId)
        )
    );
  }

  protected abstract handleEvent<N extends Event>(
    event: GameEvent<N, EP[N]>
  ): any;

  /** 向客户端广播当前的状态 */
  @debounce(0)
  protected broadcastState() {
    debug("broadcast state: %o", this.state);
    this.players.map((player) =>
      this.masterClient.sendEvent(
        ProtocalEvent.UPDATE,
        this.filter(this.state, player),
        {
          targetActorIds: [player.actorId]
        }
      )
    );
  }

  /**
   * 派发游戏事件，在服务端派发的事件只会在服务端被处理
   * @param name 事件名
   * @param payload 事件的有效载荷
   */
  protected emitEvent = <N extends Event>(
    name: N,
    payload?: EP[N],
    options: {
      /** 以某位玩家的身份派发 */
      emitter?: Player;
    } = {}
  ) => this.internalEmitEvent(name, payload, Env.SERVER, options.emitter)

  /** @ignore */
  private internalEmitEvent<N extends Event>(
    name: N,
    payload?: EP[N],
    emitterEnv = Env.CLIENT,
    emitter?: Player
  ) {
    debug("event: %o", {
      emitterId: emitter ? emitter.userId : undefined,
      name,
      payload,
    });
    const context = {
      emitter,
      emitterEnv,
      env: Env.SERVER,
      players: this.players
    };
    const event = {
      ...payload,
      ...context,
      payload,
      type: name
    } as GameEvent<N, EP[N]>;
    this.handleEvent(event);
  }
}

/**
 * 状态化的游戏
 */
class StatefulGame<
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends StatefulGameBase<State, Event, EP> {
  constructor(
    room: Room,
    masterClient: Play,
    protected state: State,
    protected events: EventHandlers<State, Event, EP> = {},
    protected filter: (state: State, player: Player) => State = (
      s: State,
      player: Player
    ) => s
  ) {
    super(room, masterClient);
  }

  protected getState = () => this.state;
  protected setState = (state: Partial<State>) => {
    this.state = {
      ...this.state,
      ...state
    };
    this.broadcastState();
  }

  protected handleEvent<N extends Event>(event: GameEvent<N, EP[N]>) {
    const handler = this.events[event.type as N];
    if (handler) {
      handler(
        {
          emitEvent: this.emitEvent,
          getState: this.getState,
          setState: this.setState
        },
        event
      );
    }
  }
}

export const defineGame = <
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
>({
  /** 游戏初始状态 */
  initialState,
  /** 事件处理方法 */
  events,
  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  filter
}: {
  initialState: State;
  events?: EventHandlers<State, Event, EP>;
  filter?: (state: State, player: Player) => State;
  // tslint:disable-next-line:callable-types
}): new (room: Room, masterClient: Play) => StatefulGame<State, Event, EP> => {
  // This is a workaround for https://github.com/Microsoft/TypeScript/issues/17293
  return class extends StatefulGame<State, Event, EP> {
    constructor(room: Room, masterClient: Play) {
      super(room, masterClient, initialState, events, filter);
    }
  };
};

/**
 * 使用 Redux 进行状态管理的游戏
 */
abstract class ReduxGame<
  State extends { [key: string]: any },
  Action extends ReduxAction,
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends StatefulGameBase<State, Event, EP> {
  protected readonly store: Store<State, Action>;
  protected get state() {
    return this.store.getState();
  }
  protected dispatch: Dispatch<Action>;

  constructor(
    room: Room,
    masterClient: Play,
    reducer: Reducer<State, Action>,
    protected events: ReduxEventHandlers<State, Event, EP, Action> = {},
    protected filter: (state: State, player: Player) => State = (
      state: State,
      player: Player
    ) => state
  ) {
    super(room, masterClient);
    this.store = createStore(reducer);
    this.store.subscribe(this.broadcastState.bind(this));
    this.dispatch = this.store.dispatch;
  }

  protected handleEvent<N extends Event>(event: GameEvent<N, EP[N]>) {
    const handler = this.events[event.type as N];
    if (handler) {
      handler(
        {
          dispatch: this.store.dispatch,
          emitEvent: this.emitEvent,
          getState: this.getState
        },
        event
      );
    }
  }
  protected getState = () => this.state;
}

export const defineReduxGame = <
  State extends { [key: string]: any },
  Action extends ReduxAction,
  Event extends string | number,
  EP extends EventPayloads<Event>
>({
  /** 游戏状态转移规则 */
  reducer,
  /** 事件处理方法 */
  events,
  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  filter
}: {
  reducer: Reducer<State, Action>;
  events?: ReduxEventHandlers<State, Event, EP, Action>;
  filter?: (state: State, player: Player) => State;
  // tslint:disable-next-line:callable-types
}): new (room: Room, masterClient: Play) => ReduxGame<State, Action, Event, EP> => {
  // This is a workaround for https://github.com/Microsoft/TypeScript/issues/17293
  return class extends ReduxGame<State, Action, Event, EP> {
    constructor(room: Room, masterClient: Play) {
      super(room, masterClient, reducer, events, filter);
    }
  };
};

declare type getStateType<
  Context,
  Schema extends StateSchema,
  Event extends string | number,
  EP extends EventPayloads<Event>,
> = Pick<
  StateMachine<Context, Schema, GameEventType<EP>>["initialState"],
  "value" | "context"
>;

/**
 * 使用 XState 进行状态管理的游戏
 */
export class XStateGame<
  Context,
  Schema extends StateSchema,
  Event extends string | number,
  EP extends EventPayloads<Event>,
> extends StatefulGameBase<getStateType<Context, Schema, Event, EP>, Event, EP> {
  public get state() {
    return pick(this.service.state, ["value", "context"]);
  }

  protected service = interpret(this.machine);

  constructor(
    room: Room,
    masterClient: Play,
    private machine: StateMachine<Context, Schema, GameEventType<EP>>,
    protected filter: (
      state: getStateType<Context, Schema, Event, EP>,
      player: Player
    ) => getStateType<Context, Schema, Event, EP> = (
      state: getStateType<Context, Schema, Event, EP>,
      player: Player
    ) => state
  ) {
    super(room, masterClient);
    this.service.onChange(this.broadcastState.bind(this));
    this.service.start();
  }

  protected handleEvent<N extends Event>(event: GameEvent<N, EP[N]>) {
    this.service.send(event);
  }
}

export const defineXStateGame = <
  Context,
  Schema extends StateSchema,
  Event extends string | number,
  EP extends EventPayloads<Event>,
>({
  machine,
  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  filter
}: {
  machine: StateMachine<Context, Schema, GameEventType<EP>>;
  filter?: (
    state: getStateType<Context, Schema, Event, EP>,
    player: Player
  ) => getStateType<Context, Schema, Event, EP>;
  // tslint:disable-next-line:callable-types
}): { new (room: Room, masterClient: Play): XStateGame<Context, Schema, Event, EP> } => {
  // This is a workaround for https://github.com/Microsoft/TypeScript/issues/17293
  return class extends XStateGame<Context, Schema, Event, EP> {
    constructor(room: Room, masterClient: Play) {
      super(room, masterClient, machine, filter);
    }
  };
};
