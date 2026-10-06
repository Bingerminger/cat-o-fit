# Training science

**English** · [Deutsch](../de/knowledge/training-science.md)

Periodisation, zones, pace, load and energy – the knowledge behind the plans, with the formulas
Cat-O-Fit actually calculates.

> Part of the [documentation](../README.md) · [Understand](../README.md#understand) ·
> Sources: [Methods & sources](methods-and-sources.md)

**On this page:**

- [Training knowledge](#training-knowledge)
- [Load in numbers](#load-in-numbers)
- [Form, prediction and training pace](#form-prediction-and-training-pace)
- [Energy supply](#energy-supply)
- [Limits](#limits)

---

## Training knowledge

**The training phases (periodisation).** A good plan builds up in phases: *Base* (easy volume),
*Build* (threshold, speed endurance), *Peak* (short fast efforts and race pace), *Taper* (volume
down, arrive at the start fresh).

**Heart rate zones.** Five zones from your max HR: Z1 Recovery, Z2 Base endurance (“conversational”
pace, this is where endurance is built), Z3 Steady tempo, Z4 Threshold, Z5 VO₂max (only briefly). If
you do not know your max HR, Cat-O-Fit can estimate it from your age on request (208 − 0.7 × age) –
clearly marked as an estimate, because in an individual case it is often 10 beats off. With your
**resting heart rate** you can have the zones calculated from the **heart rate reserve** (Karvonen);
for base endurance they are then usually somewhat higher.

**Pace ranges.** Every session type has a pace range in min/km (or min/mi, if you chose miles),
derived from your goal time or your current form – a suggestion, not a must. Form on the day counts.

**RPE (1–10).** Your subjective sense of effort complements heart rate and pace – especially on days
when numbers “feel different”. 1 is very light, 3 easy, 5 medium, 7 hard, 10 maximal.

**Session types.** Running sessions (Recovery, Easy run, Long run, Tempo / threshold, Intervals (VO₂),
Race), Strength & **Gym training**, Mobility, **Walking** and **Hiking**, **Swimming**, **Rowing**,
Bike ride & **Indoor cycling**, **Elliptical**, ball sports (**Tennis, Badminton, Squash, Table
tennis**, Football) as well as Cross-training and Rest day. All except the rest day can be started in
workout mode with a stopwatch and count towards the total load.

---

## Load in numbers

All load verdicts have **one source**: the load points of each session.

| Quantity | How Cat-O-Fit calculates it |
|---|---|
| **Load points (AU, session RPE)** | Duration in minutes × effort (RPE 1–10). If the duration is missing: from the distance per sport, then the planned duration, finally 30 minutes. If the effort is missing: a typical value for the type of session. |
| **Load ratio (ACWR)** | Load of the last 7 days ÷ weekly average of the 21 days before (“uncoupled” – the acute days are not part of the comparison value). 0.8–1.3 means: close to your average. There is no verdict yet in the first four weeks. |
| **Fitness (CTL) and fatigue (ATL)** | Exponentially smoothed daily load with time constants of 42 and 7 days (after Banister). |
| **Form (TSB)** | Fitness − fatigue, classified **relative to fitness**: fresh (above +10%), balanced, in training (down to −30%), clearly tired. Judged only from about 90 days of data. |
| **Monotony and strain** | Weekly average of the daily load ÷ its standard deviation (after Foster); strain = weekly load × monotony. A hint appears only at a monotony of 2 or more **and** a week at least 10% above your usual weekly load; sessions up to RPE 3 do not count. |

The limits 0.8/1.3/1.5 come from observational data in team sports. That training by this traffic
light prevents injuries is **not proven** – Cat-O-Fit uses it as a hint of how much your load has
risen compared with your own average, not as a promise of protection.

---

## Form, prediction and training pace

- **VDOT** is a form value after Jack Daniels: a distance and a time give a level of performance, from
  which equivalent times for other distances and training paces are derived.
- **Current form:** per week the best **hard** run (race, tempo, intervals, or an effort of 7 or more,
  or a heart rate from zone 4), more recent weeks weighted more strongly, outliers capped (median ±
  3 × MAD, half-life two weeks). Easy runs only count as a lower bound.
- **Prediction:** the equivalent time of your form for the race distance. For the half marathon and
  the marathon it holds only with suitable volume (marathon: from about 50 km a week and a long run of
  about 25 km or more; half marathon: from about 30 km and about 15 km) – otherwise the prediction
  carries a caveat. If hard runs are missing, the app uses the Riegel formula instead.
- **Training pace in the plan:** training from the slower of goal and form performance, the **race
  pace** from the goal time. If the goal time is more than 3 VDOT points above your form, the app says
  so and trains by your form.

---

## Energy supply

**Energy availability** is the energy eaten minus the energy used in training, divided by the
fat-free mass in kg. The guideline is about **45 kcal per kg**; with a weight-loss goal, 30–45 is
acceptable for a while, and below that (for men below 25) it becomes critical for hormones, bones and
recovery – in sports medicine a lasting deficit is called **RED-S**. Cat-O-Fit calculates only with
days you have confirmed with “Mark day complete”, and shows a range because all input values are
estimates.

When losing weight, the daily target stays above the **basal metabolic rate** (Mifflin-St Jeor) and
above the training need plus 30 kcal per kg of fat-free mass; without a body-fat value the deficit is
capped at 15%. Below a target BMI of 18.5 the app calculates no deficit.

---

## Limits

Cat-O-Fit serves **documentation and general information for healthy adults** – it is not a medical
device, makes no diagnosis and does not replace training or medical advice. All figures are
orientation from models; how you feel counts for more than any number.
