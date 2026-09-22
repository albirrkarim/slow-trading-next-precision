For not the src/lib/precision is consuming function from src/lib/slowTrading

since the src/lib/precision is the new version of the src/lib/slowTrading, we need to migrate the function from src/lib/slowTrading to src/lib/precision

i plan to delete `src/lib/slowTrading`

So we need produce new function that straight forward align with the new architecture of src/lib/precision

that pass down the `state` it has `markPrice` and the `vPointsMap` so the child function can use it directly 

without making call again to the API or diging from stirage.

it will be on src/lib/precision/features/*






