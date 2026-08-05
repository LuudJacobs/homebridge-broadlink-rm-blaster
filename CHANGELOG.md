# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

- Added `broadlink-rm-learner`, an interactive CLI to learn IR/RF codes
  straight from a remote and write the resulting Basic Accessory, TV, or
  Dimmer Light into `config.json` - backs up `config.json` to
  `config.json.backup` once per session before writing anything.

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
