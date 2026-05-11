# TETROBOT Project Notes

This file is the visible workspace version of the project context, so you can open it in VS Code any time. It captures the current hardware setup, control model, and competition demo idea.

## Project Summary

TETROBOT is a modular robotic arm project for the Techgium competition. The setup uses only 2 arms because of student budget constraints, but the design is intended to demonstrate a much larger modular system.

The main idea is not a random free-moving robot. Instead, each arm moves in a controlled, lock-to-lock pattern on a large cardboard sheet with custom 3D-printed floor locks. The arms bend into a U-shape and travel from one nearby floor lock to another. One arm can also dock to the other arm using the same locking system, so the two arms can behave as one larger arm when connected.

The system also supports modular tools such as a gripper or claw at the tip. These modules can be swapped independently by unlocking one module and locking another in its place.

## Mechanical Design

### Arm Structure
Each arm has 7 motors total:

- 3 main bending motors
- 2 rotation motors at both ends
- 2 lock motors at both ends

### Main Bending Motors
These are the primary movement motors for the arm body.

- DS51150: 180 degree servo
- DS5180: 270 degree servo
- Used for bending / reaching / shaping the arm into a U form

### Rotation Motors
These are MG996R motors placed at both ends of the arm.

- 180 degree rotation
- Used for rotation and orientation control
- Powered through a stepped-down supply

### Lock Motors
These are also MG996R motors placed at both ends.

- 180 degree rotation
- Control the custom 3D-printed lock mechanism
- Used for floor locking and arm-to-arm docking

### Floor Lock System
The arms sit on a cardboard base with designed floor locks.

- Each arm can lock onto these floor points
- Motion is limited to those lock positions
- The arm moves by unlocking, bending, shifting, and relocking
- This is the core competition visual: controlled modular movement, not uncontrolled roaming

### Arm-to-Arm Docking
The arms can connect to each other using the same lock system.

- One arm can detach from the floor
- Both arms can then behave like one larger arm
- This demonstrates modular cooperation and mechanical reconfiguration

### End Modules
The tip of the arm can carry different modules.

- Gripper / claw
- Other special modules
- Modules are independent and can be swapped mechanically
- Switching modules changes the arm’s function without redesigning the whole system

## Power Setup

Power distribution is important because the motors have different voltage requirements.

- Main supply: 12V to the robotic arm system
- DS51xx motors: run directly from 12V
- MG996R motors: stepped down to 7V

This separation matters because the DS51xx and MG996R motors are not being driven from the same voltage level.

## Electronics and Control

### ESP32
Each module is controlled by ESP32.

- The project uses ESP32 for all module control
- Code, board choice, and pins may differ slightly between the two arms
- Future ESP code should be checked carefully before use because the hardware variations matter

### Communication Model
The current software expects each arm to expose endpoints such as:

- /status
- /run
- /setdelay?val=...
- /action?type=home|homebody|homelock|stop

The visible web interface polls each arm and sends commands through a local proxy during development.

## Web App Overview

The repository currently contains a React + Vite control interface in src/App4.jsx.

### Main Features
- Two separate workspaces for two arms
- Script input for each arm
- Command parsing and preview
- Run, reverse, home, stop, and mirror controls
- Status polling for both arms
- Live logs and summary cards
- A dark, competition-style layout

### Script Format
The UI accepts line-by-line commands. Commands on the same line are comma-separated and run together.

Examples:

- 1s30
- 2s40,3s70
- wait1000
- home
- homebody
- homelock

### Script Meaning
- 1s30 means servo 1 goes to 30 degrees
- wait1000 means wait for 1000 ms
- home means return to the home pose
- homebody and homelock are special motor states for body and locking motions

## Competition Story

This is the story the demo should show:

1. Two arms begin on separate floor locks
2. Each arm bends into a U-shape and moves from one lock to another nearby
3. One arm can connect to the other arm using the same locking system
4. One arm detaches from the floor and both arms can act as a single larger arm
5. End modules such as a gripper or claw can be changed independently
6. The whole system shows modularity, mechanical reconfiguration, and low-cost innovation

## Important Constraints

- There are only 2 arms because of budget limits
- The motion range is limited by the floor locks and lock geometry
- The system should never be described as a free-roaming microbot swarm
- The arm positions are intentionally constrained and structured
- Pin mappings and firmware details may change between arms
- The MG996R motors must stay on the stepped-down voltage path

## Files in This Project

- src/App4.jsx - Main controller UI
- src/main.jsx - React entry point
- src/index.css - Global styles
- vite.config.js - Vite config and ESP proxy
- README.md - Base project info

## Notes for Future Chats

When starting a new chat, this file should be enough to recover the main idea of the project:

- modular robotic arm project for Techgium
- 2 arms only
- custom 3D-printed locking system
- floor locks on cardboard sheet
- arm-to-arm docking
- interchangeable tip modules
- ESP32-based control
- DS51xx at 12V, MG996R at 7V
- code and pins may differ between the two arms

## Next Information I Still Need Later

When you are ready, the next useful thing to add is the exact ESP32 pin mapping and the actual firmware code for each arm.
