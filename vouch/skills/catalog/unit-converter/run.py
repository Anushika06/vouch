import json
import sys

FACTORS = {("km", "mi"): 0.621371, ("mi", "km"): 1.609344, ("kg", "lb"): 2.204623, ("lb", "kg"): 0.453592}
q = json.loads(sys.stdin.read() or "{}")
v, a, b = float(q.get("value", 1)), q.get("from", "km"), q.get("to", "mi")
if (a, b) == ("c", "f"):
    out = v * 9 / 5 + 32
elif (a, b) == ("f", "c"):
    out = (v - 32) * 5 / 9
else:
    out = v * FACTORS.get((a, b), 1.0)
print(f"{v:g} {a} = {out:.2f} {b}")
