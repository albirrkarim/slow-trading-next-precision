using the 

vpoint.maxUpPct
vpoint.maxDownPct

we can use as indicator like 

for example the treshold is 5%


example

current vpoint = BOTTOM

vpoint.maxUpPct = 0
vpoint.maxDownPct = 3

since we already know it will form BOTTOM again  we can SHORT. entry at 3% and profit 2% because the VPOINT Threshold is 5%

i need to have tools below the "VPoints Summary" in the backtest. "next vpoint predictive" it has input the threshold likelyness it will form next vpoint

so i can adjust the 3% or maybe 4% 

to see the accuracy % 

and also show what vpoint are failed to predict



@todo.md#L15-16 you see we have two number here so i need input two number.  

favorable threshold and adverse threshold

i need to entry when favorable is reach && oposite is below the adverse threshold

so on the report i need to have like True positive, True negative, False positive, False negative

and explain what each mean with tooltip. on the true positiive etc