import * as _ from 'lodash';
import { BitmexRequest } from 'bitmex-request';
import * as traderUtils from './utils/traderUtils';
import { sortOrderBooks, verifyObPollVsObWs } from './utils/parsingUtils';
import * as EventEmitter from 'events';
import * as moment from 'moment';
import { BybitOb } from './types/bybit.type';
import { OrderBookItem, OrderBookSchema } from 'bitmex-request';

export namespace BybitOrderBookKeeper {
  export interface Options {
    testnet?: boolean;
    enableEvent?: boolean;
  }
}
// TODO: replace to real BybitRequest;
const BybitRequest = BitmexRequest;
export class BybitOrderBookKeeper extends EventEmitter {
  protected lastObWsTime?: Date;
  protected storedObs: Record<string, Record<string, BybitOb.OBRow>> = {};
  protected testnet: boolean;
  protected enableEvent: boolean;
  protected bybitRequest: any;

  VERIFY_OB_PERCENT = 0;
  VALID_OB_WS_GAP = 20 * 1000;

  constructor(options: BybitOrderBookKeeper.Options) {
    super();
    this.testnet = options.testnet || false;
    this.enableEvent = options.enableEvent || false;
    this.bybitRequest = new BybitRequest({ testnet: this.testnet });
  }

  // either parsed object or raw text
  onSocketMessage(msg: any) {
    try {
      const res = _.isString(msg) ? JSON.parse(msg) : msg;
      const pairMatch = res.topic.match(/^orderBookL2_25\.(.*)/);
      const pair = pairMatch && pairMatch[1];
      if (pair) {
        this.storedObs[pair] = this.storedObs[pair] || {};
        this._saveWsObData(res);
      }
    } catch (e) {
      console.error(moment().format('YYYY-MM-DD HH:mm:ss'), e);
    }
  }

  protected _saveWsObData(obs: BybitOb.OrderBooks) {
    if (_.includes(['snapshot'], obs.type)) {
      // first init, refresh ob data.
      const obRows = (obs as BybitOb.OrderBooksNew).data;
      _.each(obRows, row => {
        this.storedObs[row.symbol][String(row.id)] = row;
      });
    } else if (obs.type === 'delta') {
      // if this order exists, we update it, otherwise don't worry
      _.each((obs as BybitOb.OrderBooksDelta).data.update, row => {
        if (this.storedObs[row.symbol][String(row.id)]) {
          // must update one by one because update doesn't contain price
          this.storedObs[row.symbol][String(row.id)].size = row.size;
          this.storedObs[row.symbol][String(row.id)].side = row.side;
        }
      });
      _.each((obs as BybitOb.OrderBooksDelta).data.insert, row => {
        this.storedObs[row.symbol][String(row.id)] = row;
      });
      _.each((obs as BybitOb.OrderBooksDelta).data.delete, row => {
        delete this.storedObs[row.symbol][String(row.id)];
      });
    }

    this.lastObWsTime = new Date();
    if (this.enableEvent) {
      this.emit(`orderbook`, this._getCurrentRealTimeOB(obs.topic.match(/orderBookL2_25\.(.*)/)![1]));
    }
  }

  onOrderBookUpdated(callback: (ob: OrderBookSchema) => any) {
    this.on('orderbook', callback);
  }

  protected _getCurrentRealTimeOB(pair: string): OrderBookSchema | null {
    const dataRaw = this.storedObs[pair];
    if (!dataRaw) return null;
    const bidsUnsortedRaw = _.filter(dataRaw, o => o.side === 'Buy' && o.size > 0);
    const askUnsortedRaw = _.filter(dataRaw, o => o.side === 'Sell' && o.size > 0);
    const bidsUnsorted: OrderBookItem[] = _.map(bidsUnsortedRaw, d => ({ r: +d.price, a: d.size }));
    const asksUnsorted: OrderBookItem[] = _.map(askUnsortedRaw, d => ({ r: +d.price, a: d.size }));

    return sortOrderBooks({
      pair,
      ts: this.lastObWsTime!,
      bids: bidsUnsorted,
      asks: asksUnsorted,
    });
  }

  // Get WS ob, and fall back to poll. also verify ws ob with poll ob
  async getOrderBook(pairEx: string, forcePoll?: boolean): Promise<OrderBookSchema> {
    if (forcePoll || !traderUtils.isTimeWithinRange(this.lastObWsTime, this.VALID_OB_WS_GAP)) {
      if (!forcePoll)
        console.warn(
          moment().format('YYYY-MM-DD HH:mm:ss') +
            ` this.lastObWsTime=${this.lastObWsTime} is outdated, polling instead`,
        );
      return await this.bybitRequest.pollOrderBook(pairEx);
    }
    let obPoll;

    const verifyWithPoll = Math.random() < this.VERIFY_OB_PERCENT;
    if (verifyWithPoll) {
      obPoll = await this.bybitRequest.pollOrderBook(pairEx);
    }

    const obFromRealtime = this._getCurrentRealTimeOB(pairEx);

    if (obFromRealtime && obFromRealtime.bids.length > 0 && obFromRealtime.asks.length > 0) {
      if (verifyWithPoll) {
        verifyObPollVsObWs(obPoll, obFromRealtime);
      }
      return obFromRealtime;
    }

    console.warn(
      moment().format('YYYY-MM-DD HH:mm:ss') + ` orderbookws not available, polling instead obWs=${obFromRealtime}`,
    );
    if (obPoll) {
      return obPoll;
    }
    return await this.bybitRequest.pollOrderBook(pairEx);
  }
}