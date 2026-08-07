# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [1.7.0] - 2026-08-07

### Added
- MQTT control for simple on/off accessories, advanced accessories, dimmer
  lights and TVs, alongside fans. Simple accessories, advanced accessories
  and TVs take `{"state": "ON"}`; dimmers also take `{"level": 50}`.
- Accessories controlled over MQTT publish their own on/off state as
  `{"state": "ON"}` whenever they turn on or off, however that was
  triggered.
- Fans: a "Swing On Power On" option that starts the fan oscillating
  whenever it is turned on, sent once the speed has settled. Skipped if it
  is already swinging, since the signal is usually a toggle.

### Changed
- MQTT commands are now read from `<topic>/set` rather than `<topic>`,
  which is left to carry the accessory's state. An existing fan keeps its
  configured topic, but whatever publishes to it has to move to
  `<topic>/set`.
- Retaining MQTT messages is set per device and per accessory - "Retain
  sensor data messages" on an RM device, "Retain state messages" on an
  accessory - instead of one setting covering everything. Both default to
  on, so retaining carries on as before.

### Fixed
- Sliding a fan on fired a signal the instant HomeKit reported it active,
  while the slider was still moving. On a fan whose speed button is also
  its power button that press is part of the very sequence the slider is
  about to work out, so it read as one signal too many. Turning on now
  waits on the same settle as the slider, and a slide sends one burst at
  the end. Turning off stays immediate.
- Turning a simple accessory or TV off with no Power Off Signal configured
  logged "Sent Power Off" while actually re-sending Power On, which only
  turns anything off if that signal is a toggle. The log now names the
  signal really sent.

## [1.6.0] - 2026-08-07

### Added
- Fans: a new accessory type. A fan has any number of speeds (one cycle
  button, or separate up and down buttons), optional swing, and any number
  of extra on/off features such as cooling, each exposed as its own
  labelled switch. Power can come from a dedicated button - a single
  toggle or separate on/off - or from whichever speed, swing or feature
  button actually powers the fan.
- Fans: an optional signal sent every time the fan is turned on, for
  things like maxing out a heater's thermostat.
- Fans: an optional resync switch that clears what the plugin thinks the
  fan is doing without sending any signals, for when the fan has been used
  from its own remote.
- Fans: swing can also be put on its own switch, since the Home app hides
  its built-in oscillate control once an accessory is more than just a
  fan.
- Fans can be driven from MQTT. Give a fan a topic and it listens on
  `<base topic>/<topic>` for messages like
  `{"state":"ON", "speed": 100, "swing": "ON"}`. Anything left out is not
  changed, and retained messages are applied on connect.
- `broadlink-rm-learner`: a "Just show hex code" option that captures one
  signal and prints it for copy/pasting, without saving anything.

### Changed
- "Basic Accessories" renamed to "Simple On/Off Accessories" in the Config
  UI form and the learner.
- The learner's menu order now matches the Config UI form's sections.

### Fixed
- Dragging a fan's speed slider sent a signal for every position it passed
  through. It is now debounced (0.5s by default) and acts only on where
  the slider lands.
- A fan feature with no name took the whole accessory down at startup,
  which could happen after saving the fan in the Config UI. Unusable
  features are skipped with a warning instead.
- Blank rows left behind in any accessory list by saving the Config UI
  form no longer log warnings about accessories named "undefined".
- Config UI field descriptions no longer lose text wrapped in angle
  brackets, which the form renders as HTML. The MQTT base topic
  description had been affected since 1.3.0.

## [1.5.0] - 2026-08-06

### Added
- Advanced Accessories: a new standalone accessory type where one button
  press sends multiple signals in sequence, with a configurable timeout
  between them. An optional Off signal gives it real on/off state (a
  normal Switch); without one, it's an auto-resetting momentary trigger
  instead. `broadlink-rm-learner` can learn these too.

## [1.4.0] - 2026-08-05

### Added
- `broadlink-rm-learner`, an interactive CLI to learn IR/RF codes straight
  from a remote and write the resulting Basic Accessory, TV, or Dimmer
  Light into `config.json` - backs up `config.json` to `config.json.backup`
  once per session before writing anything. RF codes are learned at a known
  frequency (defaults to 433.92 MHz, entered by hand) rather than an
  automatic sweep, which proved unreliable on real hardware. Menu choices
  resolve on a single keypress, no Enter required. Connects to the RM
  device before prompting to press any button, rather than after. Dimmer
  Light learning asks the number of brightness levels up front, then Power
  On/Off, then each brightness signal from 0% up to 100% last.

### Changed
- README: moved the learner CLI's docs into a new "Learning hex codes"
  section under Configuration (previously part of Debugging), and removed
  the link to the standalone `learn-broadlink-rm4-codes` project.

## [1.3.2] - 2026-08-04

### Added
- MQTT "Retain Messages" checkbox (defaults to on, matching the previous
  unconditional behavior).

### Changed
- Added 1.5rem spacing between config form sections.
- Corrected the `mqttBaseTopic` field's example device name/topic pairing.

## [1.3.1] - 2026-08-03

### Added
- `displayName` in `package.json` ("Broadlink RM Blaster"), so Homebridge UI
  shows a friendlier name than the npm package name.

### Changed
- README title changed to "Broadlink RM Blaster <version>".

## [1.3.0] - 2026-08-02

### Added
- Optional MQTT publishing of temperature/humidity readings, so other
  plugins (e.g. `homebridge-mqttthing`) can subscribe to them. Controlled by
  an `enableMqtt` checkbox plus `mqttHost`/`mqttPort` (and optional
  `mqttUsername`/`mqttPassword`/`mqttBaseTopic`), and a separate
  `enableMqttPublish` checkbox per RM device, independent of the existing
  `enableTemperatureHumidity` HomeKit sensor checkbox - either, both, or
  neither can be enabled.

### Changed
- Reorganized the Config UI X settings form: Accessories, Dimmer Lights, TVs
  (and Dimmer Lights' Brightness Levels), and new Notifications/MQTT fields
  are now collapsed fieldsets, so the form isn't a huge wall of fields by
  default.
- Trimmed redundant field descriptions and tightened several labels across
  the config form.

## [1.2.1] - 2026-07-27

### Fixed
- The `ntfyTopic` config field's description only mentioned the
  RM-connection-failure trigger, not the temperature/humidity sensor's
  5-consecutive-failed-readings trigger.

### Changed
- ntfy notification bodies now use a short, fixed message pointing at the
  Homebridge logs, instead of the raw error text (which included the RM's
  IP address).

## [1.2.0] - 2026-07-26

### Changed
- `package.json`'s `files` list now explicitly includes README, LICENSE and
  CHANGELOG alongside the published `dist` output.
- README restructured: Requirements/Installation/Usage sections, version
  number in the title, Features/Configuration/Debugging nested under Usage,
  license/changelog links at the bottom.

## [1.1.1] - 2026-07-26

### Added
- Temperature/humidity sensor now shows "No Response" in Home and sends an
  ntfy notification after 5 consecutive failed readings, instead of silently
  keeping the last known value forever.

## [1.1.0] - 2026-07-25

### Added
- Optional `ntfyTopic` config field: sends a push notification via ntfy.sh
  the first time an RM device fails to connect.

## [1.0.4] - 2026-07-23

### Changed
- Reverted the `.npmignore` added in 1.0.3 (inert; `package.json`'s `files`
  field already controls what's published).

## [1.0.3] - 2026-07-23

### Added
- `.npmignore`.

## [1.0.2] - 2026-07-22

### Fixed
- Reverted 1.0.1's per-IP placeholder MAC (broke authentication with real
  Broadlink hardware); fixed the underlying multi-device registry collision
  with a private `Broadlink` instance per configured RM device instead.

## [1.0.1] - 2026-07-22

### Fixed
- Second configured RM device permanently failing to authenticate, and a
  `MaxListenersExceededWarning` on repeated connection retries.

## [1.0.0] - 2026-07-20

### Added
- First public release: basic accessories (light/switch/outlet/fan), dimmer
  lights with brightness levels, TV remote accessory, temperature/humidity
  sensor, multi-RM-device support, CLI diagnostic tool.

## [0.9.1] - 2026-07-20

### Changed
- README restructured: configuration section now leads with Homebridge
  Config UI X support, `config.json` example moved to its own subsection.
