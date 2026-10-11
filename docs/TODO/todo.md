http://localhost:3010/dev/backtest-precision


I need metrics like this

because the missScore above 3 is considered wrong

so for example the dataset total is 3000 and 500 is missscore above 3


I need calculation like this


candidate correct: 3000 - 500 = 2500

candidate incorrect: 500


for exampe the feature gate resulting accepting (pass) of 2200 inside it has 200 wrong (missScore > 3) and 2000 correct (missScore <= 3)

accuracy of accepting correct is  = 2000 / 2500  = 80%

accuracy of rejecting wrong is  = 300 / 500  = 60%

accuracy of correct pass is = 2000 / 2200 = 90.91%