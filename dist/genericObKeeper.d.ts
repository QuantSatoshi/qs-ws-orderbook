import { OrderBookSchema, OrderBookItem } from 'qs-typings';
import { BaseKeeper } from './baseKeeper';
import { GenericObKeeperShared } from './utils/genericObKeeperShared';
export declare namespace GeneticObKeeper {
    interface Options {
        enableEvent?: boolean;
    }
}
export declare class GenericObKeeper extends BaseKeeper {
    obKeepers: Record<string, GenericObKeeperShared>;
    onReceiveOb(params: {
        pair: string;
        bids: OrderBookItem[];
        asks: OrderBookItem[];
        isNewSnapshot?: boolean;
    }): void;
    onReceiveTick(pair: string, tick: number[]): void;
    emitOrderbookEvent(pair: string): void;
    getOrderBookWs(pair: string, depth?: number): OrderBookSchema;
    getOrderBook(pair: string): Promise<OrderBookSchema>;
    onOrderBookUpdated(callback: (ob: OrderBookSchema) => any): void;
}
