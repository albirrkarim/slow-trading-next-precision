
# Goal

I need to config + strategy that can

produce profit every day. we might harnesssing the low level volatility such as the 0-2 (and paired with the VOLATILITY_THRESHOLD =2%) so its easy move for making daily profit.

when the level goes high we must try to stop it and put some position on the other account (because we have the multi account trade) to coverup the losses.

So the main strategy is averaging

think the account 1 low level usd might loses, so it will be cover up account 2 entry then profit.

so we can define the initial balance for both account.

i will think it as minimum equity to run the config+strategy. more low more better but i notice that minimum margin on one entry is $6 on binance

# Strategy

currenly we have many strategy `lib/strategies`

- default

- both

- streak

- ai_custom_v1: you might make your own strategy to accomplish my goals

# Tools

AI agent might using the MCP "precision-trading-localhost"