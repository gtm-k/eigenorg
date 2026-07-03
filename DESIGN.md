---
version: alpha
name: Linear-design-analys
is
description: "A near-black product-focused
 marketing canvas built around #010102 (the d
eepest dark surface of any tool in this colle
ction), light gray text (#f7f8f8), and the si
gnature Linear lavender-blue (#5e6ad2) used a
s the single chromatic accent. The system rea
ds as software-craft documentation: dense, te
chnical, and quietly luxurious. Display type 
is set in the Linear custom sans (SF Pro Disp
lay fallback) at 500–700 with measured nega
tive tracking. Cards live as charcoal panels 
(#0f1011) with hairline borders. The accent l
avender appears on the brand mark, focus ring
s, and a few intentional CTAs — never decor
atively. Page rhythm leans on product UI scre
enshots framed in dark panels rather than atm
ospheric color."

colors:
  primary: "#5e6ad2
"
  on-primary: "#ffffff"
  primary-hover: "#
828fff"
  primary-focus: "#5e69d1"
  ink: "#f
7f8f8"
  ink-muted: "#d0d6e0"
  ink-subtle: "
#8a8f98"
  ink-tertiary: "#62666d"
  canvas: 
"#010102"
  surface-1: "#0f1011"
  surface-2:
 "#141516"
  surface-3: "#18191a"
  surface-4
: "#191a1b"
  hairline: "#23252a"
  hairline-
strong: "#34343a"
  hairline-tertiary: "#3e3e
44"
  inverse-canvas: "#ffffff"
  inverse-sur
face-1: "#f5f6f6"
  inverse-surface-2: "#f6f7
f7"
  inverse-ink: "#000000"
  brand-secure: 
"#7a7fad"
  semantic-success: "#27a644"
  sem
antic-overlay: "#000000"

typography:
  displ
ay-xl:
    fontFamily: Linear Display
    fon
tSize: 80px
    fontWeight: 600
    lineHeigh
t: 1.05
    letterSpacing: -3.0px
  display-l
g:
    fontFamily: Linear Display
    fontSiz
e: 56px
    fontWeight: 600
    lineHeight: 1
.10
    letterSpacing: -1.8px
  display-md:
 
   fontFamily: Linear Display
    fontSize: 4
0px
    fontWeight: 600
    lineHeight: 1.15

    letterSpacing: -1.0px
  headline:
    fon
tFamily: Linear Display
    fontSize: 28px
  
  fontWeight: 600
    lineHeight: 1.20
    le
tterSpacing: -0.6px
  card-title:
    fontFam
ily: Linear Display
    fontSize: 22px
    fo
ntWeight: 500
    lineHeight: 1.25
    letter
Spacing: -0.4px
  subhead:
    fontFamily: Li
near Display
    fontSize: 20px
    fontWeigh
t: 400
    lineHeight: 1.40
    letterSpacing
: -0.2px
  body-lg:
    fontFamily: Linear Te
xt
    fontSize: 18px
    fontWeight: 400
   
 lineHeight: 1.50
    letterSpacing: -0.1px
 
 body:
    fontFamily: Linear Text
    fontSi
ze: 16px
    fontWeight: 400
    lineHeight: 
1.50
    letterSpacing: -0.05px
  body-sm:
  
  fontFamily: Linear Text
    fontSize: 14px

    fontWeight: 400
    lineHeight: 1.50
    
letterSpacing: 0
  caption:
    fontFamily: L
inear Text
    fontSize: 12px
    fontWeight:
 400
    lineHeight: 1.40
    letterSpacing: 
0
  button:
    fontFamily: Linear Text
    f
ontSize: 14px
    fontWeight: 500
    lineHei
ght: 1.20
    letterSpacing: 0
  eyebrow:
   
 fontFamily: Linear Text
    fontSize: 13px
 
   fontWeight: 500
    lineHeight: 1.30
    l
etterSpacing: 0.4px
  mono:
    fontFamily: L
inear Mono
    fontSize: 13px
    fontWeight:
 400
    lineHeight: 1.50
    letterSpacing: 
0

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  l
g: 12px
  xl: 16px
  xxl: 24px
  pill: 9999px

  full: 9999px

spacing:
  xxs: 4px
  xs: 8p
x
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px

  xxl: 48px
  section: 96px

components:
  b
utton-primary:
    backgroundColor: "{colors.
primary}"
    textColor: "{colors.on-primary}
"
    typography: "{typography.button}"
    r
ounded: "{rounded.md}"
    padding: 8px 14px

  button-primary-pressed:
    backgroundColor
: "{colors.primary-focus}"
    textColor: "{c
olors.on-primary}"
    typography: "{typograp
hy.button}"
    rounded: "{rounded.md}"
  but
ton-primary-hover:
    backgroundColor: "{col
ors.primary-hover}"
    textColor: "{colors.o
n-primary}"
    typography: "{typography.butt
on}"
    rounded: "{rounded.md}"
  button-sec
ondary:
    backgroundColor: "{colors.surface
-1}"
    textColor: "{colors.ink}"
    typogr
aphy: "{typography.button}"
    rounded: "{ro
unded.md}"
    padding: 8px 14px
  button-ter
tiary:
    backgroundColor: "{colors.canvas}"

    textColor: "{colors.ink}"
    typography
: "{typography.button}"
    rounded: "{rounde
d.md}"
    padding: 8px 14px
  button-inverse
:
    backgroundColor: "{colors.inverse-canva
s}"
    textColor: "{colors.inverse-ink}"
   
 typography: "{typography.button}"
    rounde
d: "{rounded.md}"
    padding: 8px 14px
  pri
cing-card:
    backgroundColor: "{colors.surf
ace-1}"
    textColor: "{colors.ink}"
    typ
ography: "{typography.body}"
    rounded: "{r
ounded.lg}"
    padding: 24px
  pricing-card-
featured:
    backgroundColor: "{colors.surfa
ce-2}"
    textColor: "{colors.ink}"
    typo
graphy: "{typography.body}"
    rounded: "{ro
unded.lg}"
    padding: 24px
  feature-card:

    backgroundColor: "{colors.surface-1}"
   
 textColor: "{colors.ink}"
    typography: "{
typography.body}"
    rounded: "{rounded.lg}"

    padding: 24px
  product-screenshot-card:

    backgroundColor: "{colors.surface-1}"
  
  textColor: "{colors.ink}"
    typography: "
{typography.body}"
    rounded: "{rounded.xl}
"
    padding: 24px
  testimonial-card:
    b
ackgroundColor: "{colors.surface-1}"
    text
Color: "{colors.ink}"
    typography: "{typog
raphy.body-lg}"
    rounded: "{rounded.lg}"
 
   padding: 32px
  customer-logo-tile:
    ba
ckgroundColor: "{colors.canvas}"
    textColo
r: "{colors.ink-subtle}"
    typography: "{ty
pography.caption}"
    rounded: "{rounded.xs}
"
    padding: 16px
  text-input:
    backgro
undColor: "{colors.surface-1}"
    textColor:
 "{colors.ink}"
    typography: "{typography.
body}"
    rounded: "{rounded.md}"
    paddin
g: 8px 12px
  text-input-focused:
    backgro
undColor: "{colors.surface-1}"
    textColor:
 "{colors.ink}"
    typography: "{typography.
body}"
    rounded: "{rounded.md}"
    paddin
g: 8px 12px
  pricing-tab-default:
    backgr
oundColor: "{colors.canvas}"
    textColor: "
{colors.ink-subtle}"
    typography: "{typogr
aphy.button}"
    rounded: "{rounded.pill}"
 
   padding: 6px 14px
  pricing-tab-selected:

    backgroundColor: "{colors.surface-2}"
   
 textColor: "{colors.ink}"
    typography: "{
typography.button}"
    rounded: "{rounded.pi
ll}"
    padding: 6px 14px
  cta-banner:
    
backgroundColor: "{colors.surface-1}"
    tex
tColor: "{colors.ink}"
    typography: "{typo
graphy.headline}"
    rounded: "{rounded.lg}"

    padding: 48px
  changelog-row:
    backg
roundColor: "{colors.canvas}"
    textColor: 
"{colors.ink}"
    typography: "{typography.b
ody}"
    rounded: "{rounded.xs}"
    padding
: 24px 0
  status-badge:
    backgroundColor:
 "{colors.surface-2}"
    textColor: "{colors
.ink-muted}"
    typography: "{typography.cap
tion}"
    rounded: "{rounded.pill}"
    padd
ing: 2px 8px
  top-nav:
    backgroundColor: 
"{colors.canvas}"
    textColor: "{colors.ink
}"
    typography: "{typography.body-sm}"
   
 rounded: "{rounded.xs}"
    height: 56px
  f
ooter:
    backgroundColor: "{colors.canvas}"

    textColor: "{colors.ink-subtle}"
    typ
ography: "{typography.caption}"
    rounded: 
"{rounded.xs}"
    padding: 64px 32px
---

##
 Overview

Linear's marketing canvas is the d
eepest dark surface in this collection — `{
colors.canvas}` is #010102, essentially pure 
black with a faint blue tint. On top sits a f
our-step surface ladder (`{colors.surface-1}`
 through `{colors.surface-4}`) for cards, pan
els, and lifted tiles, with hairline borders 
running from `{colors.hairline}` (#23252a) up
 through `{colors.hairline-strong}` and `{col
ors.hairline-tertiary}`. Light gray text (`{c
olors.ink}` #f7f8f8) carries the body and hea
dlines.

The single chromatic accent is **Lin
ear lavender-blue** `{colors.primary}` (#5e6a
d2) — used on the brand mark, focus rings, 
and the primary CTA button. A lighter hover s
tate (`{colors.primary-hover}` #828fff) and a
 focus-tinted variant (`{colors.primary-focus
}` #5e69d1) extend the same hue. Linear avoid
s saturated greens, oranges, reds, etc. on th
e marketing canvas — the only semantic colo
r is `{colors.semantic-success}` (#27a644) fo
r status pills and the rare success indicator
.

Display type runs Linear's custom sans (wi
th `SF Pro Display` fallback) at weight 500�
�700 with negative letter-spacing scaling fro
m -3.0px at 80px down to 0 at body. The body 
family is Linear's text cut, and a Linear Mon
o is reserved for code snippets in product sc
reenshots.

The page rhythm is **dense produc
t screenshots** — Linear's marketing leads 
with high-fidelity captures of the product UI
 (issue list, project view, dashboard) framed
 in `{colors.surface-1}` panels with `{rounde
d.xl}` 16px corners. The chrome is intentiona
lly minimal so the app screenshots can do the
 heavy lifting.

**Key Characteristics:**
- *
*Dark-canvas marketing system** — `{colors.
canvas}` (#010102) is the deepest dark in thi
s collection.
- **Lavender-blue brand accent*
* (`{colors.primary}` #5e6ad2) — used scarc
ely on brand mark, focus, and the primary CTA
.
- Four-step surface ladder (canvas → surf
ace-1 → surface-2 → surface-3 → surface
-4) carries hierarchy without shadow.
- Displ
ay tracking pulls aggressively negative (-3.0
px at 80px); body holds at -0.05px.
- Cards u
se `{rounded.lg}` 12px corners with 1px hairl
ine borders — never pill, rarely 16px.
- **
Product UI screenshots** dominate the page. T
he marketing chrome is a dark frame for the a
pp.
- No second chromatic color. No atmospher
ic gradients. No spotlight cards.

## Colors


> Source pages: linear.app (home), /intake, 
/pricing, /contact/sales, /build.

### Brand 
& Accent
- **Lavender-Blue** ({colors.primary
}): The signature Linear accent — primary C
TA, brand mark, link emphasis.
- **Lavender H
over** ({colors.primary-hover}): Lighter lave
nder (#828fff) — hovered state of the prima
ry CTA.
- **Lavender Focus** ({colors.primary
-focus}): Focus-ring tint (#5e69d1) — focus
ed inputs, focused buttons.
- **Brand Secure*
* ({colors.brand-secure}): Muted lavender-gra
y (#7a7fad) — used in "Linear Security" sur
faces.

### Surface
- **Canvas** ({colors.can
vas}): Default page background — #010102, n
ear-pure black with a faint blue tint.
- **Su
rface 1** ({colors.surface-1}): One step abov
e canvas — feature cards, pricing cards, pr
oduct screenshot panels.
- **Surface 2** ({co
lors.surface-2}): Two steps above — feature
d pricing card, hovered cards.
- **Surface 3*
* ({colors.surface-3}): Three steps above —
 line-tertiary backgrounds, sub-nav.
- **Surf
ace 4** ({colors.surface-4}): Four steps abov
e — bg-level-3, deepest lifted surface.
- *
*Hairline** ({colors.hairline}): 1px borders 
on cards and dividers.
- **Hairline Strong** 
({colors.hairline-strong}): Stronger 1px bord
ers — input focus rings.
- **Hairline Terti
ary** ({colors.hairline-tertiary}): Tertiary 
borders for nested surfaces.
- **Inverse Canv
as** ({colors.inverse-canvas}): Pure white �
� surface of the inverse pill CTA on a small 
set of section openers.
- **Inverse Surface 1
** ({colors.inverse-surface-1}): One step abo
ve inverse canvas.
- **Inverse Surface 2** ({
colors.inverse-surface-2}): Two steps above i
nverse canvas.

### Text
- **Ink** ({colors.i
nk}): All headlines and emphasized body type 
— light gray #f7f8f8.
- **Ink Muted** ({col
ors.ink-muted}): Secondary type at #d0d6e0 �
� meta info on hero panels.
- **Ink Subtle** 
({colors.ink-subtle}): Tertiary type at #8a8f
98 — deselected pricing tabs, footer column
s.
- **Ink Tertiary** ({colors.ink-tertiary})
: Quaternary at #62666d — disabled, footnot
es.

### Semantic
- **Success Green** ({color
s.semantic-success}): Status pills, success i
ndicators. The only semantic color on marketi
ng.
- **Overlay** ({colors.semantic-overlay})
: Pure black overlay scrim for modals.

## Ty
pography

### Font Family

- **Linear Display
** — Linear's custom display sans; fallback
 `SF Pro Display, -apple-system, system-ui, S
egoe UI, Roboto`. Carries display-xl through 
subhead.
- **Linear Text** — Linear's custo
m text sans (a slightly different cut tuned f
or body sizes); same fallback stack. Carries 
body sizes, button labels, captions.
- **Line
ar Mono** — Linear's custom mono; fallback 
`ui-monospace, SF Mono, Menlo`. Used for code
 snippets in product screenshots and for stat
us / ID tokens.

The marketing surface treats
 Display and Text as one continuous voice; th
e family change is silent.

### Hierarchy

| 
Token | Size | Weight | Line Height | Letter 
Spacing | Use |
|---|---|---|---|---|---|
| `
{typography.display-xl}` | 80px | 600 | 1.05 
| -3.0px | Largest hero headline |
| `{typogr
aphy.display-lg}` | 56px | 600 | 1.10 | -1.8p
x | Section opener headlines |
| `{typography
.display-md}` | 40px | 600 | 1.15 | -1.0px | 
Sub-section headlines |
| `{typography.headli
ne}` | 28px | 600 | 1.20 | -0.6px | Pricing t
ier titles, CTA banner heading |
| `{typograp
hy.card-title}` | 22px | 500 | 1.25 | -0.4px 
| Feature card title |
| `{typography.subhead
}` | 20px | 400 | 1.40 | -0.2px | Lead body, 
intro paragraphs |
| `{typography.body-lg}` |
 18px | 400 | 1.50 | -0.1px | Hero subhead, l
ead paragraphs |
| `{typography.body}` | 16px
 | 400 | 1.50 | -0.05px | Default body |
| `{
typography.body-sm}` | 14px | 400 | 1.50 | 0 
| Card body, footer columns |
| `{typography.
caption}` | 12px | 400 | 1.40 | 0 | Captions,
 meta, status |
| `{typography.button}` | 14p
x | 500 | 1.20 | 0 | All button labels |
| `{
typography.eyebrow}` | 13px | 500 | 1.30 | 0.
4px | Section eyebrow (slight positive tracki
ng) |
| `{typography.mono}` | 13px | 400 | 1.
50 | 0 | Linear Mono for code in product scre
enshots |

### Principles

- **Aggressive neg
ative tracking on display** (-3.0px at 80px �
�� 4% of size).
- **Single voice from display
 to body.** Display-xl at 600 → body at 400
 — same family, narrower weights.
- **Eyebr
ow uses positive tracking** (+0.4px) — cont
rast against the negative-tracked display mar
ks the eyebrow as taxonomy.
- **Mono only in 
code contexts.** Linear Mono lives inside pro
duct screenshots — not on marketing chrome.


### Note on Font Substitutes

Linear's cust
om typeface isn't publicly distributed; the d
ocumented fallback `SF Pro Display, -apple-sy
stem, system-ui` is the recommended substitut
e on macOS. For cross-platform implementation
, **Inter** at weight 500 / 600 / 700 is the 
closest free substitute. **Geist Sans** is al
so viable. For mono, **JetBrains Mono** or **
Geist Mono** at weight 400 closely approximat
es Linear Mono.

## Layout

### Spacing Syste
m

- **Base unit**: 4px.
- **Tokens (front ma
tter)**: `{spacing.xxs}` 4px · `{spacing.xs}
` 8px · `{spacing.sm}` 12px · `{spacing.md}
` 16px · `{spacing.lg}` 24px · `{spacing.xl
}` 32px · `{spacing.xxl}` 48px · `{spacing.
section}` 96px.
- Card interior padding: `{sp
acing.lg}` 24px on feature/pricing cards; `{s
pacing.xl}` 32px on testimonial cards; `{spac
ing.xxl}` 48px on CTA banners.
- Pill button 
padding: 8px vertical · 14px horizontal — 
Linear's compact button spec.
- Form input pa
dding: 8px vertical · 12px horizontal.

### 
Grid & Container

- Max content width sits ar
ound 1280px.
- Card grids are 3-up at desktop
, 2-up at tablet, 1-up at mobile.
- Pricing t
ier grid is 3-up; comparison strip below show
s checkmarks per tier.
- Product screenshot p
anels span full content width — they're the
 protagonist.

### Whitespace Philosophy

The
 dark canvas IS the whitespace. Sections sepa
rate by lift onto surface-1 panels, not by ga
ps in white. Within a panel, generous `{spaci
ng.lg}` 24px gaps between content blocks; `{s
pacing.section}` 96px between sections.

## E
levation & Depth

| Level | Treatment | Use |

|---|---|---|
| 0 (flat) | No shadow, no bor
der | Default for body type, hero text, foote
r |
| 1 (charcoal lift) | `{colors.surface-1}
` background on canvas, 1px `{colors.hairline
}` | Default cards, product panels |
| 2 (sur
face-2 lift) | `{colors.surface-2}` backgroun
d, 1px `{colors.hairline-strong}` | Featured 
pricing card, hovered cards |
| 3 (surface-3 
lift) | `{colors.surface-3}` background | Sub
-nav, dropdown menus |
| 4 (focus ring) | 2px
 `{colors.primary-focus}` outline at 50% opac
ity | Focused input, focused button |

Linear
's depth is carried by surface ladder + hairl
ine borders. The brand resists drop shadows o
n dark almost entirely.

### Decorative Depth


- **Product UI screenshots** dominate as de
corative depth.
- **No atmospheric gradients,
 no spotlight cards.**
- **Subtle white edge 
highlight** on the top edge of lifted panels 
— gives the dark surface a faint "pixel ren
dered" feel.

## Shapes

### Border Radius Sc
ale

| Token | Value | Use |
|---|---|---|
| 
`{rounded.xs}` | 4px | Small chips, status ba
dges |
| `{rounded.sm}` | 6px | Inline tags |

| `{rounded.md}` | 8px | All buttons, form i
nputs |
| `{rounded.lg}` | 12px | Pricing car
ds, feature cards, testimonial cards |
| `{ro
unded.xl}` | 16px | Product screenshot panels
 |
| `{rounded.xxl}` | 24px | Oversized CTA b
anners (rare) |
| `{rounded.pill}` | 9999px |
 Pricing tab toggles, status pills |
| `{roun
ded.full}` | 9999px | Avatar circles |

### P
hotography & Illustration Geometry

- Product
 UI screenshots dominate; they sit in `{round
ed.xl}` 16px tiles with `{spacing.lg}` 24px o
uter padding.
- Customer logo tiles render at
 small sizes (~24px logo height) on `{colors.
canvas}` with no border.
- Avatar circles in 
testimonial cards use `{rounded.full}` at 32�
��40px sizes.

## Components

### Buttons

**
`button-primary`** — Lavender CTA. The defa
ult primary CTA across all pages.
- Backgroun
d `{colors.primary}`, text `{colors.on-primar
y}`, type `{typography.button}`, padding 8px 
14px, rounded `{rounded.md}`.
- Pressed state
 lives in `button-primary-pressed` (backgroun
d shifts to `{colors.primary-focus}`).
- Hove
r state lives in `button-primary-hover` (back
ground shifts to `{colors.primary-hover}` lig
hter lavender).

**`button-secondary`** — C
harcoal button. Used for secondary CTAs ("Sig
n in", "Read changelog").
- Background `{colo
rs.surface-1}`, text `{colors.ink}`, type `{t
ypography.button}`, padding 8px 14px, rounded
 `{rounded.md}`. 1px `{colors.hairline}` bord
er.

**`button-tertiary`** — Plain text but
ton.
- Background `{colors.canvas}`, text `{c
olors.ink}`, type `{typography.button}`, roun
ded `{rounded.md}`, padding 8px 14px.

**`but
ton-inverse`** — White-on-dark inverse CTA.

- Background `{colors.inverse-canvas}`, text
 `{colors.inverse-ink}`, type `{typography.bu
tton}`, rounded `{rounded.md}`, padding 8px 1
4px.

### Pricing Tabs

**`pricing-tab-defaul
t`** + **`pricing-tab-selected`** — Pill-to
ggle on `/pricing`.
- Default: `{colors.canva
s}` background, `{colors.ink-subtle}` text, r
ounded `{rounded.pill}`, padding 6px 14px.
- 
Selected: `{colors.surface-2}` background, `{
colors.ink}` text — selected = surface lift
.

### Cards & Containers

**`pricing-card`**
 — Each tier on `/pricing`.
- Background `{
colors.surface-1}`, text `{colors.ink}`, type
 `{typography.body}`, rounded `{rounded.lg}`,
 padding 24px. 1px `{colors.hairline}` border
.

**`pricing-card-featured`** — Recommende
d tier — surface lift to surface-2.
- Backg
round `{colors.surface-2}`, otherwise identic
al structure.

**`feature-card`** — Generic
 feature highlight tile.
- Background `{color
s.surface-1}`, text `{colors.ink}`, type `{ty
pography.body}`, rounded `{rounded.lg}`, padd
ing 24px.

**`product-screenshot-card`** — 
The dominant card type — frames a high-fide
lity Linear app UI screenshot.
- Background `
{colors.surface-1}`, text `{colors.ink}`, typ
e `{typography.body}`, rounded `{rounded.xl}`
, padding 24px.

**`testimonial-card`** — C
ustomer quote with avatar + name + role.
- Ba
ckground `{colors.surface-1}`, text `{colors.
ink}`, type `{typography.body-lg}`, rounded `
{rounded.lg}`, padding 32px.

**`customer-log
o-tile`** — Small tile in the customer marq
uee.
- Background `{colors.canvas}`, text `{c
olors.ink-subtle}`, type `{typography.caption
}`, rounded `{rounded.xs}`, padding 16px.

**
`cta-banner`** — Closing CTA panel near pag
e bottom.
- Background `{colors.surface-1}`, 
text `{colors.ink}`, type `{typography.headli
ne}`, rounded `{rounded.lg}`, padding 48px.


### Inputs & Forms

**`text-input`** + **`tex
t-input-focused`** — Form fields on `/conta
ct/sales` and signup overlays.
- Background `
{colors.surface-1}`, text `{colors.ink}`, typ
e `{typography.body}`, rounded `{rounded.md}`
, padding 8px 12px.
- Focused state retains t
he same surface; the focus ring is a 2px `{co
lors.primary-focus}` outline at 50% opacity.


### Status & Build Page

**`changelog-row`**
 — Each row in `/build` (changelog page) li
sting version, date, and changes.
- Backgroun
d `{colors.canvas}`, text `{colors.ink}`, typ
e `{typography.body}`, rounded `{rounded.xs}`
, padding 24px 0. 1px `{colors.hairline}` bot
tom rule.

**`status-badge`** — Small statu
s pill.
- Background `{colors.surface-2}`, te
xt `{colors.ink-muted}`, type `{typography.ca
ption}`, rounded `{rounded.pill}`, padding 2p
x 8px.

### Navigation

**`top-nav`** — Sti
cky dark bar with the Linear wordmark left, p
rimary nav links centered, and a `button-seco
ndary` ("Sign in") + `button-primary` ("Get s
tarted") pair right.
- Background `{colors.ca
nvas}`, text `{colors.ink}`, type `{typograph
y.body-sm}`, height 56px.

### Footer

**`foo
ter`** — Dense link grid on `{colors.canvas
}` with the Linear wordmark left.
- Backgroun
d `{colors.canvas}`, text `{colors.ink-subtle
}`, type `{typography.caption}`, padding 64px
 32px.

## Do's and Don'ts

### Do

- Reserve
 `{colors.canvas}` (#010102) as the system's 
anchor surface — the faint blue tint is int
entional.
- Use `{colors.primary}` lavender O
NLY for: brand mark, primary CTA, focus ring,
 link emphasis.
- Use the four-step surface l
adder for hierarchy. Avoid skipping levels.
-
 Pair display weight 600 with body weight 400
 — Linear resists 700+ display weights.
- A
pply negative letter-spacing aggressively on 
display.
- Use product UI screenshots as the 
protagonist of every section.
- Compose CTAs 
as `{rounded.md}` 8px corners.

### Don't

- 
Don't ship a light-mode marketing page.
- Don
't use lavender as a section background or ca
rd fill.
- Don't introduce a second chromatic
 accent (orange, pink, green for marketing).

- Don't add atmospheric gradients or spotligh
t cards.
- Don't pill-round CTAs.
- Don't use
 `#000000` true black as the canvas.
- Don't 
combine multiple bright accents in product sc
reenshot mockups.

## Responsive Behavior

##
# Breakpoints

| Name | Width | Key Changes |

|---|---|---|
| Desktop-XL | 1440px | Defaul
t desktop layout |
| Desktop | 1280px | Card 
grid 3-up maintained |
| Tablet | 1024px | Ca
rd grid 3-up → 2-up |
| Mobile-Lg | 768px |
 Pricing comparison becomes accordion; nav ha
mburger |
| Mobile | 480px | Single-column; d
isplay-xl scales 80px → ~36px |

### Touch 
Targets

- CTAs hold ≥40px tap height acros
s viewports.
- Pricing tab pills hold ≥36px
 tap height; touch viewports grow to ≥44px.

- Form inputs hold ≥44px tap target on tou
ch.

### Collapsing Strategy

- **Top nav**: 
links collapse to hamburger below 768px.
- **
Card grids**: 3-up → 2-up at 1024px → 1-u
p below 768px.
- **Pricing comparison**: per-
tier accordion below 768px.
- **Display type*
*: `{typography.display-xl}` 80px scales towa
rd `{typography.display-md}` 40px on mobile.


### Image Behavior

- Product UI screenshots
 maintain aspect ratio and never crop.
- Cust
omer logos in the marquee may collapse from 6
-up to 3-up below 768px.

## Iteration Guide


1. Focus on ONE component at a time and refe
rence it by its `components:` token name.
2. 
When introducing a section, decide first whic
h surface lift it lives on.
3. Default body t
o `{typography.body}` at weight 400.
4. Run `
npx @google/design.md lint DESIGN.md` after e
dits.
5. Add new variants as separate compone
nt entries.
6. Treat lavender as scarce: bran
d mark, primary CTA, focus, link emphasis.
7.
 Lead every section with a product UI screens
hot.

## Known Gaps

- The four-step surface 
ladder values are extracted directly from Lin
ear's `--color-bg-level-3`, `--color-line-tin
t`, etc. CSS variables; they are Linear's can
onical surface spec.
- Form-field error and v
alidation styling is not visible on the inspe
cted pages.
- Light mode is not documented be
cause the marketing site does not ship a ligh
t theme.
- Linear's actual product UI uses a 
richer color-tag palette (red, orange, yellow
, green, blue, purple) for issue priorities a
nd project labels — those colors live in th
e in-product surfaces shown in mockups.
- The
 custom display, text, and mono families are 
proprietary; an open-source substitute is acc
eptable.


