# Heat Exchanger Lab

An interactive 3D counter-flow shell & tube heat exchanger simulator: ε-NTU physics that runs in the browser, drawn with Three.js.

![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-0.169-000000?logo=threedotjs&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?logo=javascript&logoColor=black)

## Overview

Heat Exchanger Lab models a 37-tube, 5-baffle shell & tube exchanger. Hot water flows through the tubes and cold water flows through the shell in the opposite direction. When you move a slider, the app solves the outlet temperatures with the ε-NTU method, checks the answer against the LMTD and energy-balance equations, and updates a 3D scene. In that scene, fluid colour, flow speed, vapor, mist and condensation all follow the solved state.

The heat-transfer model (`src/lib/physics.js`) is pure JavaScript with no Three.js or DOM dependencies. The renderer only displays results and never computes heat transfer itself.

## Features

- Real-time ε-NTU solution for a counter-flow exchanger, with LMTD and ṁ·Cp·ΔT cross-checks shown side by side
- Axial temperature profile along the exchanger, taken from the counter-flow energy balance
- Three view modes: **Realistic**, **Temperature** (colour-mapped fluid with a legend) and **Flow**
- Three shell modes: **Solid**, **Transparent** and **Cutaway**
- Five camera presets: Overview, Cutaway, Tube Bundle, Hot Side and Cold Side
- Clickable temperature sensors (TI-101/102 on the tube side, TI-201/202 on the shell side). Each shows a popup with temperature and flow in kg/s and L/min
- Ambient air controls (temperature, relative humidity) with a live dew point. These drive the visual effects only

## Physics model

Fluids and geometry are fixed in `src/lib/physics.js`:

| Quantity | Value |
|---|---|
| Hot fluid (tube side) | water, $c_p = 4190$ J/kg·K, $\rho = 970$ kg/m³ |
| Cold fluid (shell side) | water, $c_p = 4180$ J/kg·K, $\rho = 998$ kg/m³ |
| Tubes | 37 (hex bundle, 3 rings), OD 25 mm, ID 21 mm, length 4.0 m |
| Shell crossflow area | 0.018 m² |
| Heat-transfer area | $A = \pi D_o L N \approx 11.6$ m² |

**Capacity rates and NTU**

$$
C_h = \dot m_h c_{p,h}, \quad C_c = \dot m_c c_{p,c}, \quad C_r = \frac{C_{min}}{C_{max}}, \quad NTU = \frac{UA}{C_{min}}
$$

**Counter-flow effectiveness**

$$
\varepsilon = \frac{1 - e^{-NTU(1 - C_r)}}{1 - C_r\, e^{-NTU(1 - C_r)}}, \qquad \varepsilon = \frac{NTU}{1 + NTU} \ \text{ when } C_r = 1
$$

**Heat duty and outlet temperatures**

$$
Q = \varepsilon\, C_{min}\,(T_{h,i} - T_{c,i}), \quad T_{h,o} = T_{h,i} - \frac{Q}{C_h}, \quad T_{c,o} = T_{c,i} + \frac{Q}{C_c}
$$

**LMTD check** (should reproduce $Q$)

$$
\Delta T_1 = T_{h,i} - T_{c,o}, \quad \Delta T_2 = T_{h,o} - T_{c,i}, \quad \Delta T_{lm} = \frac{\Delta T_1 - \Delta T_2}{\ln(\Delta T_1 / \Delta T_2)}, \quad Q_{UA} = UA\,\Delta T_{lm}
$$

**Axial profile.** $s \in [0, 1]$ runs along the hot flow. The hot inlet is at $s = 0$ and the cold inlet is at $s = 1$.

$$
k = UA\left(\frac{1}{C_h} - \frac{1}{C_c}\right), \quad f(s) = \frac{1 - e^{-ks}}{1 - e^{-k}}, \quad
T_h(s) = T_{h,i} - (T_{h,i} - T_{h,o})\,f(s), \quad T_c(s) = T_{c,o} - (T_{c,o} - T_{c,i})\,f(s)
$$

When $k \to 0$, $f(s) = s$.

**Velocities**

$$
v_{tube} = \frac{\dot m_h}{\rho_h \cdot N \pi D_i^2 / 4}, \qquad v_{shell} = \frac{\dot m_c}{\rho_c \cdot A_{shell}}
$$

**Dew point** (`src/lib/ambient.js`, Magnus–Tetens, $a = 17.62$, $b = 243.12$ °C). This is used only for the visual effects.

$$
\gamma = \ln\!\left(\frac{RH}{100}\right) + \frac{a T_a}{b + T_a}, \qquad T_d = \frac{b\,\gamma}{a - \gamma}
$$

This is a simplified lumped model with no CFD. $U$ is a user input and is not computed from film coefficients.

## Controls and UI panels

**Toolbar (top)**: View (Realistic / Temperature / Flow), Shell (Solid / Transparent / Cutaway), Camera presets.

**Process Inputs (left)**

| Input | Range | Default |
|---|---|---|
| Hot inlet temperature $T_{h,i}$ | 40–150 °C | 90 °C |
| Cold inlet temperature $T_{c,i}$ | 5–40 °C | 20 °C |
| Hot flow rate $\dot m_h$ | 0.1–3 kg/s | 1.0 kg/s |
| Cold flow rate $\dot m_c$ | 0.1–3 kg/s | 1.5 kg/s |
| Overall $U$ | 100–2000 W/m²K | 600 W/m²K |

The app keeps $T_{h,i}$ at least 5 °C above $T_{c,i}$.

**Ambient Air (left)**: air temperature 10–40 °C (default 30), relative humidity 20–100 % (default 70), and the computed dew point.

**Engineering Data (right)**: inlet and outlet temperatures, heat transfer rate (kW), effectiveness (%), flow rates. An energy-balance check compares hot-side Q, cold-side Q, $UA\,\Delta T_{lm}$ and $\Delta T_{lm}$. Design parameters show A, UA, NTU, $C_r$, tube velocity and shell crossflow velocity.

**Viewport**: drag to rotate, right-drag to pan, scroll the wheel to zoom, click a sensor for readings.

## Visual effects

All effects live in `src/three/effects/`. They read from the solved state and ambient inputs.

- **Water material**: `MeshPhysicalMaterial` with transmission, IOR 1.333, blue-green attenuation and animated normal ripples. Flow rate, temperature and local turbulence set how much the water moves.
- **Bubbles**: sparse air bubbles carried along the flow lanes. They swirl more and gather more densely near baffles, nozzles and tube entries.
- **Condensation**: droplets on the outer shell wherever the wall is below the dew point. They nucleate, grow and merge, slide down with wet trails, and drip off the bottom (instanced meshes).
- **Vapor and cold mist**: GPU particle fields animated in the vertex shader. Vapor rises from surfaces well above ambient temperature. Mist forms where the wall is below the dew point.
- **Heat haze**: a screen-space refraction post-process pass above hot surfaces, with up to 6 emitters.
- **Temperature colour map**: a 5-stop scale stretched across the current $T_{c,i}$–$T_{h,i}$ range.

## Tech stack

| Package | Version |
|---|---|
| react / react-dom | ^18.3.1 |
| three | ^0.169.0 (OrbitControls, RoomEnvironment, EffectComposer addons) |
| vite | ^5.4.11 |
| @vitejs/plugin-react | ^4.3.4 |

## Getting started

Requires Node.js and npm.

```bash
npm install
npm run dev       # start the Vite dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

## Project structure

```
heat_exchanger_sim/
├── index.html                    # Vite entry HTML
├── vite.config.js                # Vite config with the React plugin
├── package.json
└── src/
    ├── main.jsx                  # React root mount
    ├── App.jsx                   # App state (inputs, view/shell mode, ambient, camera preset)
    ├── App.css                   # Layout and panel styles
    ├── components/
    │   ├── Toolbar.jsx           # View / Shell / Camera buttons
    │   ├── ControlPanel.jsx      # Process and ambient sliders, model notes
    │   ├── DataPanel.jsx         # Results, energy-balance check, design parameters
    │   └── Viewport.jsx          # Three.js host, legend, sensor popups
    ├── lib/
    │   ├── physics.js            # ε-NTU / LMTD solver and axial profile (no rendering)
    │   └── ambient.js            # Dew point (Magnus–Tetens)
    └── three/
        ├── HeatExchangerView.js  # Scene build, camera presets, render loop, public API
        ├── layout.js             # Shared scene geometry and turbulence mask
        └── effects/
            ├── waterMaterial.js  # Physically based animated water
            ├── bubbles.js        # Entrained air bubbles
            ├── condensation.js   # Shell condensation droplets and trails
            ├── softParticles.js  # GPU vapor / mist particles
            └── heatHaze.js       # Screen-space heat haze shader
```
