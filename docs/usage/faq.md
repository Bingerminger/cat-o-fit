# Frequently asked questions

**English** · [Deutsch](../de/usage/faq.md)

Short answers to what people often ask.

> Part of the [documentation](../README.md) · [All usage pages](../README.md#use)

---

## Tips & FAQ

**Does the app work offline?** Yes. The app saves every change on your device straight away; syncing
with your server runs in the background as soon as there is a connection again. If the server does not
answer, you carry on working offline after a few seconds.

**What if I use an iPhone and an iPad at the same time?** No problem. The server merges the changes –
if you edit different things on the two devices, **both** are kept. Nothing is lost, even if the
devices' clocks differ slightly.

**Is my data safe?** It lives as files on your own server or NAS, not in someone else's cloud. The
server only hands out cycle, labs and supplements after your PIN sign-in; all other data can be read
by any device that can reach the server – so the app belongs on your own home network. Details:
[Privacy in operation](../operations/privacy.md).

**Why does the app ask for my PIN even though I am signed in?** The sign-in with the server has
expired (30 days without use) or is needed again after an update. With the PIN, cycle, labs and
supplements sync again; “Later” postpones this until the next time you open the app – nothing is
lost.

**Forgot your PIN?** An admin sets a new one (see
[Changing or resetting your PIN](family.md#changing-or-resetting-your-pin)).

**How reliable are reminders?** Most reliable via the **calendar export (.ics)** or a
[calendar subscription](training.md#subscribe-to-the-calendar) – these reminders also work when the
app is closed.

**Something looks out of date?** Close the app completely and reopen it – when you open it and when
you return to the foreground, it fetches the latest version. More under
[Troubleshooting](../operations/troubleshooting.md).

**Which language does the app use, and can I change it?** Cat-O-Fit speaks seven languages: German,
English, French, Spanish, Italian, Brazilian Portuguese and Dutch. Each person chooses their own under
**Settings → Appearance → Language** (it applies to you on every device); the entry “Like the
instance (…)” follows the instance's default language instead. Admins set that default in Settings
(it applies to the sign-in screen and to new people). A new instance starts in your browser's language
(English if it is not one of the seven); instances that were already running before version 4.0 stay
German until someone changes it. While an admin is managing another member, the admin's own language
stays. German and English are written by the project; the other five are machine-translated with a
fixed glossary and not yet reviewed by native speakers – corrections are very welcome (see
[Translation review status](../../locales/REVIEW.md)). Units are metric (kilometres, kilograms);
imperial units are planned for version 4.1.

**Does Cat-O-Fit cost anything?** No – the app is open source (AGPL licence) and runs on your own
hardware. Only an optional extra service can cost money, such as the premium tier of “Health Auto
Export” for the automatic Apple Health import; there are also free ways (see
[Apple Health](apple-health.md)).
