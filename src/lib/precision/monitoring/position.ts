import type { RuntimeContext } from "../types";

function monitorPosition(_context: RuntimeContext) {
  // Shared market data. the latest price etc..
  // then the data Consumed by
  // this.averaging(data);
  // this.exit(data);
  // this.updateBalance;
}

function averaging(_context: RuntimeContext) {
  // trying to do averaging
  // telling outside todo something, maybe real execution etc
  // const result = await this.onAction();
  // from the result we record back to internal runtime engine stage
  // is success?
  // is it changing the position data
  // is it closed the position
  // is it live mode?
  // if yes we need to call exchange update balance
  // if not we do the calculation to update the balance with the current trade result.
}

function exit(_context: RuntimeContext) {
  // trying to do exit from the open position
  // using the config and the exit rules/ conditions we decide the exit.
  // telling outside todo something, maybe real execution etc
  // const result = await this.onAction();
  // from the result we record back to internal runtime engine stage
  // is success?
  // is it changing the position data
  // is it closed the position
  // is it live mode?
  // if yes we need to call exchange update balance
  // if not we do the calculation to update the balance with the current trade result.
}

const position = {
  averaging,
  exit,
  monitor: monitorPosition,
} as const;

export default position;
