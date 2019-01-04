import { Game } from "@leancloud/client-engine";
import { Play, Player, Room } from "@leancloud/play";
import d = require("debug");
import { debounce } from "lodash-decorators";
import { Action as ReduxAction, createStore, Dispatch, Reducer, Store} from "redux";
import { Env, EventHandlers, EventPayloads, IEventContext, ProtocalEvent, ReduxEventHandlers } from "./core";

/** @ignore */
const debug = d("StatefulGame:Server");

abstract class StatefulGameBase<
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends Game {
  /** 游戏状态 */
  protected abstract get state(): State;

  /** 事件处理方法 */
  protected abstract events: {
    [name in Event]?: (operators: any, context: IEventContext, payload: EP[name]) => any;
  };
  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  protected abstract filter: (
    state: State,
    player: Player,
  ) => State;

  constructor(room: Room, masterClient: Play) {
    super(room, masterClient);
    this.getStream(ProtocalEvent.EVENT).subscribe(
      ({ eventData: { name, payload }, senderId}) =>
        this.internalEmitEvent(name, payload, Env.CLIENT, room.getPlayer(senderId)),
    );
  }

  /** @ignore */
  protected abstract getStateOperators(): any;

  /** 向客户端广播当前的状态 */
  @debounce(0)
  protected broadcastState() {
    debug("broadcast state: %o", this.state);
    this.players.map((player) =>
      this.masterClient.sendEvent(
        ProtocalEvent.UPDATE,
        this.filter(this.state, player),
        {
          targetActorIds: [player.actorId],
        },
      ),
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
      emitter?: Player,
    } = {},
  ) => this.internalEmitEvent(name, payload, Env.SERVER, options.emitter)

  /** @ignore */
  private internalEmitEvent<N extends Event>(
    name: N,
    payload?: EP[N],
    emitterEnv = Env.CLIENT,
    emitter?: Player,
  ) {
    debug("event: %o", { name, payload, emitterId: emitter ? emitter.userId : undefined });
    const handler = this.events[name];
    if (handler) {
      const context = {
        emitter,
        emitterEnv,
        env: Env.SERVER,
        players: this.players,
      };
      handler(this.getStateOperators(), context, payload),
      this.broadcastState();
    }
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
    protected events: EventHandlers<State, Event, EP>,
    protected filter: (state: State, player: Player) => State,
  ) {
    super(room, masterClient);
  }

  protected getState = () => this.state;
  protected setState = (state: Partial<State>) => {
    this.state = {
      ...this.state,
      ...state,
    };
    this.broadcastState();
  }

  /** @ignore */
  protected getStateOperators() {
    return {
      emitEvent: this.emitEvent,
      getState: this.getState,
      setState: this.setState,
    };
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
  events = {},
  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  filter = (state: State, player: Player) => state,
}: {
  initialState: State;
  events?: EventHandlers<State, Event, EP>;
  filter?: (state: State, player: Player) => State;
// tslint:disable-next-line:callable-types
}): { new(room: Room, masterClient: Play): StatefulGame<State, Event, EP> } => {
  // This is a workaround for https://github.com/Microsoft/TypeScript/issues/17293
  return class extends StatefulGame<State, Event, EP> {
    constructor(room: Room, masterClient: Play) {
      super(room, masterClient, initialState, events, filter);
    }
  };
};

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
    protected events: ReduxEventHandlers<State, Event, EP>,
    protected filter: (state: State, player: Player) => State,
  ) {
    super(room, masterClient);
    this.store = createStore(reducer);
    this.store.subscribe(this.broadcastState.bind(this));
    this.dispatch = this.store.dispatch;
  }

  protected getState = () => this.state;
  /** @ignore */
  protected getStateOperators() {
    return {
      dispatch: this.store.dispatch,
      emitEvent: this.emitEvent,
      getState: this.getState,
    };
  }
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
  events = {},
  /** 滤镜（玩家在客户端能看到状态与游戏状态的映射关系） */
  filter = (state: State, player: Player) => state,
}: {
  reducer: Reducer<State, Action>,
  events?: ReduxEventHandlers<State, Event, EP>;
  filter?: (state: State, player: Player) => State;
// tslint:disable-next-line:callable-types
}): { new(room: Room, masterClient: Play): ReduxGame<State, Action, Event, EP> } => {
  // This is a workaround for https://github.com/Microsoft/TypeScript/issues/17293
  return class extends ReduxGame<State, Action, Event, EP> {
    constructor(room: Room, masterClient: Play) {
      super(room, masterClient, reducer, events, filter);
    }
  };
};
