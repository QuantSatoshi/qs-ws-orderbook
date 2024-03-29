import { BybitRequest } from 'bitmex-request';
import * as qsJsUtils from 'qs-js-utils';
import { verifyObPollVsObWs } from './utils/parsingUtils';
import { BybitOb } from './types/bybit.type';
import { OrderBookItem, OrderBookSchema } from 'qs-typings';
import { BaseKeeper } from './baseKeeper';
import { GenericObKeeperShared } from './utils/genericObKeeperShared';
import { binanceObToStandardOb } from './binanceFxObKeeper';

export namespace BybitOrderBookKeeper {
  export interface Options extends BaseKeeper.Options {
    testnet?: boolean;
  }
}

export class BybitOrderBookKeeper extends BaseKeeper {
  obKeepers: Record<string, GenericObKeeperShared> = {};

  // if initial, return true
  onReceiveObShared(params: { pair: string; bids: OrderBookItem[]; asks: OrderBookItem[]; isNewSnapshot?: boolean }) {
    const { pair, bids, asks, isNewSnapshot } = params;
    if (!this.obKeepers[pair]) {
      this.obKeepers[pair] = new GenericObKeeperShared();
    }
    if (isNewSnapshot) {
      this.obKeepers[pair].init();
    }
    this.obKeepers[pair].onReceiveOb({ bids, asks });

    if (this.enableEvent) {
      this.emit(`orderbook`, this.getOrderBookWs(pair));
    }
  }

  getOrderBookWs(pair: string, depth?: number): OrderBookSchema {
    if (!this.obKeepers[pair]) {
      return {
        ts: Date.now(),
        pair,
        bids: [],
        asks: [],
      };
    }

    const orderbooks: OrderBookSchema = {
      ts: Date.now(),
      pair,
      ...this.obKeepers[pair].getOb(depth),
    };
    return orderbooks;
  }

  onOrderBookUpdated(callback: (ob: OrderBookSchema) => any) {
    this.on('orderbook', callback);
  }

  protected testnet: boolean;
  protected bybitRequest: BybitRequest;
  name = 'bybitObKeeper';

  VERIFY_OB_PERCENT = 0.1;
  VALID_OB_WS_GAP = 20 * 1000;

  constructor(options: BybitOrderBookKeeper.Options) {
    super(options);
    this.testnet = options.testnet || false;
    this.bybitRequest = new BybitRequest({ testnet: this.testnet });

    this.initLogger();
  }

  // either parsed object or raw text
  onSocketMessage(msg: any) {
    try {
      const res = typeof msg === 'string' ? JSON.parse(msg) : msg;
      if (!res.topic.match(/^orderBook/)) return;

      const pair = (() => {
        let pairMatch = res && res.topic.match(/^orderBookL2_25\.(.*)/);
        if (pairMatch && pairMatch[1]) {
          return pairMatch[1];
        }
        pairMatch = res && res.topic.match(/^orderBook_200\.100ms\.(.*)/);
        if (pairMatch && pairMatch[1]) {
          return pairMatch[1];
        }
      })();
      if (pair) {
        this.lastObWsTime = new Date();
        this.onReceiveOb(res);
      }
    } catch (e) {
      this.logger.error('onSocketMessage', e);
    }
  }

  onReceiveOb(obs: BybitOb.OrderBooks, _pair?: string) {
    const obNew = obs as any;
    if (obNew.b || obNew.a) {
      if (!_pair) throw new Error(`_pair is required for new ob type bybit`);
      const pair = _pair;
      this.onReceiveObShared({
        pair,
        bids: obNew.b ? obNew.b.map(binanceObToStandardOb) : [],
        asks: obNew.a ? obNew.a.map(binanceObToStandardOb) : [],
        isNewSnapshot: (obs as any).e === 's',
      });
      if (this.enableEvent) {
        this.emitOrderbookEvent(pair);
      }
      return;
    }
    // for rebuilding orderbook process.
    if (['snapshot'].includes(obs.type)) {
      // first init, refresh ob data.
      const obRows = (obs as BybitOb.OrderBooksNew).data;
      const pair = _pair || obRows[0].symbol;
      const bids: OrderBookItem[] = [];
      const asks: OrderBookItem[] = [];
      obRows.forEach(row => {
        if (row.side === 'Buy') {
          bids.push({ r: parseFloat(row.price), a: row.size });
        } else {
          asks.push({ r: parseFloat(row.price), a: row.size });
        }
      });
      this.onReceiveObShared({ pair, bids, asks, isNewSnapshot: true });
    } else {
      const { insert, update, delete: deleted } = (obs as BybitOb.OrderBooksDelta).data;
      if (insert && insert.length > 0) {
        const pair = _pair || insert[0].symbol;
        const bids: OrderBookItem[] = [];
        const asks: OrderBookItem[] = [];
        insert.forEach(row => {
          if (row.side === 'Buy') {
            bids.push({ r: parseFloat(row.price), a: row.size });
          } else {
            asks.push({ r: parseFloat(row.price), a: row.size });
          }
        });
        this.onReceiveObShared({ pair, bids, asks });
      }

      if (update && update.length > 0) {
        const pair = _pair || update[0].symbol;
        const bids: OrderBookItem[] = [];
        const asks: OrderBookItem[] = [];
        update.forEach(row => {
          if (row.side === 'Buy') {
            bids.push({ r: parseFloat(row.price), a: row.size });
          } else {
            asks.push({ r: parseFloat(row.price), a: row.size });
          }
        });
        this.onReceiveObShared({ pair, bids, asks });
      }

      if (deleted && deleted.length > 0) {
        const pair = _pair || deleted[0].symbol;
        const bids: OrderBookItem[] = [];
        const asks: OrderBookItem[] = [];
        deleted.forEach(row => {
          if (row.side === 'Buy') {
            bids.push({ r: parseFloat(row.price), a: 0 });
          } else {
            asks.push({ r: parseFloat(row.price), a: 0 });
          }
        });
        this.onReceiveObShared({ pair, bids, asks });
      }
    }

    if (this.enableEvent) {
      const pair = _pair || obs.topic.match(/orderBookL2_25\.(.*)/)![1];
      this.emitOrderbookEvent(pair);
    }
  }

  emitOrderbookEvent(pair: string) {
    if (this.enableEvent) {
      const now = Date.now();
      // only emit event at certain gap. prevent emitting even take over full cpu usage
      if (!this.lastEventTsMap[pair] || now - this.lastEventTsMap[pair] > this.minObEventGapMs) {
        this.lastEventTsMap[pair] = now;
        this.emit(`orderbook`, this.getOrderBookWs(pair));
      }
    }
  }

  async pollOrderBook(pairEx: string): Promise<OrderBookSchema> {
    return (await this.bybitRequest.pollOrderBook(pairEx)) as any;
  }

  // Get WS ob, and fall back to poll. also verify ws ob with poll ob
  async getOrderBook(pairEx: string, forcePoll?: boolean): Promise<OrderBookSchema> {
    if (forcePoll || !qsJsUtils.isTimeWithinRange(this.lastObWsTime, this.VALID_OB_WS_GAP)) {
      if (!forcePoll)
        this.logger.warn(
          `lastObWsTime=${this.lastObWsTime && this.lastObWsTime.toISOString()} is outdated diff=(${Date.now() -
            (this.lastObWsTime ? this.lastObWsTime.getTime() : 0)}), polling instead`,
        );
      return await this.pollOrderBookWithRateLimit(pairEx);
    }
    let obPoll;

    const verifyWithPoll = Math.random() < this.VERIFY_OB_PERCENT;
    if (verifyWithPoll) {
      obPoll = await this.pollOrderBookWithRateLimit(pairEx);
    }

    const obFromRealtime = this.getOrderBookWs(pairEx);

    if (obFromRealtime && obFromRealtime.bids.length > 0 && obFromRealtime.asks.length > 0) {
      if (verifyWithPoll) {
        verifyObPollVsObWs(obPoll, obFromRealtime);
      }
      return obFromRealtime;
    }

    this.logger.warn(`orderbookws not available, polling instead obWs=${obFromRealtime}`);
    if (obPoll) {
      return obPoll;
    }
    return await this.pollOrderBookWithRateLimit(pairEx);
  }
}
