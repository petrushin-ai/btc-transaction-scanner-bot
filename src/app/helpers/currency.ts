import Big from "big.js";

import type { CurrencyService } from "@/app/services/CurrencyService";
import { logger } from "@/infrastructure/logger";
import { BTC, USD } from "@/shared/constants";
import type { AddressActivity } from "@/types/blockchain";

export async function getUsdRate(currency: CurrencyService): Promise<number> {
  try {
    const pair = await currency.getPair( BTC, USD );
    return pair.rate;
  } catch ( err ) {
    const message = err instanceof Error ? err.message : String( err );
    logger.warn( { type: "currency.error", msg: message } );
    return 0;
  }
}

export function mapActivitiesWithUsd(
  activities: AddressActivity[],
  btcToUsdRate: number
): AddressActivity[] {
  if ( !(btcToUsdRate > 0) ) return activities;
  return activities.map( (activity) => {
    const usd = new Big( activity.valueBtc ).times( btcToUsdRate );
    const rounded = Number( usd.toFixed( 2, 1 ) );
    return {
      ...activity,
      valueUsd: rounded,
    };
  } );
}


