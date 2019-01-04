import { Event as PlayEvent, Play, ReceiverGroup } from "@leancloud/play";
import { EventEmitter } from "eventemitter3";
import { Action as ReduxAction, AnyAction, createStore, Reducer, Store} from "redux";
import { devToolsEnhancer } from "redux-devtools-extension/developmentOnly";
import { Env, EventHandlers, EventPayloads, IEventContext, ProtocalEvent, ReduxEventHandlers } from "./core";

/**
 * Client Game 会派发的事件名称
 */
export const ClientEvent = {
  /** state 更新了，游戏可以根据新的 state 更新 UI */
  STATE_UPDATE: "state-update",
};

abstract class GameBaseClient<
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends EventEmitter {
  /** 游戏状态 */
  public abstract get state(): State;

  /** 游戏玩家列表（不包括 masterClient 的 playerList） */
  public get players() {
    if (!this.client.room) {
      return [];
    }
    return this.client.room.playerList.filter(
      (player) => player !== this.client.room.master,
    );
  }

  /** 客户端的事件处理方法 */
  protected abstract events: {
    [name in Event]?: (operators: any, context: IEventContext, payload: EP[name]) => any;
  };

  constructor(
    /** 当前玩家的 Client */
    protected client: Play,
  ) {
    super();
    this.client.on(
      PlayEvent.CUSTOM_EVENT,
      ({ eventId, eventData, senderId }) => {
        if (senderId !== this.client.room.masterId) {
          return;
        }
        if (eventId === ProtocalEvent.UPDATE) {
          this.onUpdate(eventData as State);
        }
      },
    );
  }

  /**
   * 派发游戏事件，在客户端派发的事件会同时在客户端与服务端被处理
   * @param name 事件名
   * @param payload 事件的有效载荷
   */
  public emitEvent = <N extends Event>(name: N, payload?: EP[N]) => {
    this.sendEventToServer(name, payload);
    const handler = this.events[name];
    if (handler) {
      const context = {
        emitter: this.client.player,
        emitterEnv: Env.CLIENT,
        env: Env.CLIENT,
        players: this.players,
      };
      handler(this.getStateOperators(), context, payload);
    }
  }

  /** @ignore */
  protected abstract getStateOperators(): any;

  /** @ignore */
  protected abstract onUpdate(nextState: State): any;

  /** @ignore */
  protected emitStateUpdateEvent = () => {
    this.emit(ClientEvent.STATE_UPDATE, this.state);
  }

  /** @ignore */
  private sendEventToServer<N extends Event>(name: N, payload: any) {
    this.client.sendEvent(
      ProtocalEvent.EVENT,
      { name, payload },
      {
        receiverGroup: ReceiverGroup.MasterClient,
      },
    );
  }

}

/**
 * 状态化的游戏客户端
 */
class GameClient<
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends GameBaseClient<State, Event, EP> {
  /** 游戏状态 */
  public state: State;

  /**
   * @param client 当前玩家的 Client
   * @param initialState 游戏初始状态
   * @param events 客户端的事件处理方法
   */
  constructor(
    client: Play,
    initialState: State,
    protected events: EventHandlers<State, Event, EP>,
  ) {
    super(client);
    this.state = initialState;
  }

  /** @ignore */
  protected getStateOperators() {
    return {
      emitEvent: this.emitEvent,
      getState: this.getState,
      setState: this.setState,
    };
  }

  /** @ignore */
  private getState = () => this.state;
  /** @ignore */
  private setState = (state: Partial<State>) => {
    this.state = {
      ...this.state,
      ...state,
    };
    this.emitStateUpdateEvent();
  }

  /** @ignore */
  // tslint:disable-next-line:member-ordering
  protected onUpdate = this.setState;
}

/** @ignore */
const ACTION_REPLACE_STATE = "_REPLACE_STATE";

/** 使用 Redux 维护状态的游戏客户端 */
class ReduxGameClient<
  State extends { [key: string]: any },
  Action extends ReduxAction,
  Event extends string | number,
  EP extends EventPayloads<Event>
> extends GameBaseClient<State, Event, EP> {
  /** 维护游戏状态的 Redux Store */
  public store: Store<State, Action>;
  /** 游戏状态 */
  public get state() {
    return this.store.getState();
  }

  /**
   * @param client 当前玩家的 Client
   * @param reducer 描述 state 如何根据 action 变化的 reducer，参见 https://redux.js.org/basics/reducers
   * @param events 客户端的事件处理方法
   */
  constructor(
    client: Play,
    reducer: Reducer<State, Action>,
    protected events: ReduxEventHandlers<State, Event, EP>,
  ) {
    super(client);
    const rootReducer = (state: any , action: AnyAction) => {
      if (action.type === ACTION_REPLACE_STATE) {
        return reducer(action.payload, action as Action);
      }
      return reducer(state as State, action as Action);
    };
    this.store = createStore(rootReducer, devToolsEnhancer({}));
    this.store.subscribe(this.emitStateUpdateEvent);
  }

  /** @ignore */
  protected getStateOperators() {
    return {
      dispatch: this.store.dispatch,
      emitEvent: this.emitEvent,
      getState: this.getState,
    };
  }

  /** @ignore */
  protected onUpdate = (nextState: State) => this.store.dispatch(this.replaceState(nextState) as any);

  /** @ignore */
  private replaceState = (nextState: State) => ({
    payload: nextState,
    type: ACTION_REPLACE_STATE,
  })

  /** @ignore */
  private getState = () => this.state;
}

/**
 * 创建一个状态化的游戏客户端
 */
export const createGameClient = <
  State extends { [key: string]: any },
  Event extends string | number,
  EP extends EventPayloads<Event>
>({
  /** 当前玩家的 Client */
  client,
  /** 游戏初始状态 */
  initialState,
  /** 客户端的事件处理方法 */
  events = {},
}: {
  client: Play;
  initialState: State;
  events?: EventHandlers<State, Event, EP>;
}) => new GameClient(client, initialState, events);

/** 创建一个使用 Redux 维护状态的游戏客户端 */
export const createReduxGameClient = <
  State extends { [key: string]: any },
  Action extends ReduxAction,
  Event extends string | number,
  EP extends EventPayloads<Event>
>({
  /** 当前玩家的 Client */
  client,
  /** 描述 state 如何根据 action 变化的 reducer，参见 https://redux.js.org/basics/reducers */
  reducer,
  /** 客户端的事件处理方法 */
  events = {},
}: {
  client: Play;
  reducer: Reducer<State, Action>;
  events?: ReduxEventHandlers<State, Event, EP>;
}) => new ReduxGameClient(client, reducer, events);
