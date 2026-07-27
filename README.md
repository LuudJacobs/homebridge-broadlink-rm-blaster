# Homebridge Broadlink RM Blaster Plugin 1.2.1

**This Homebridge plugin has been 100% vibe coded with Claude.**

Blast RF and IR signals from Broadlink RM devices using Homebridge. Sends
pre-recorded hex codes to a known device IP; does not learn signals or
autodiscover devices. To capture hex codes from your own remotes, see
[learn-broadlink-rm4-codes](https://github.com/LuudJacobs/learn-broadlink-rm4-codes).

## Requirements

- A Broadlink RM device, unlocked using the official Broadlink app (new
  devices ship locked, which blocks local API access).
- Node.js `^18.15.0 || ^20.7.0 || ^22 || ^24`
- Homebridge `^1.8.0 || ^2.0.0`

## Installation

```bash
npm install -g homebridge-broadlink-rm-blaster
```

## Usage

This plugin can be fully configured from the Homebridge Config UI X plugin
settings form. See [Configuration](#configuration) below for the full field
reference and an example `config.json`.

**TVs don't appear automatically alongside your other accessories.** HomeKit
only shows a proper TV tile/remote when it's added as its own accessory, so
each one needs to be paired separately: after restarting Homebridge, check
its log for a line like `Please add [name] manually in Home app. Setup
Code: ...` for each configured TV, then add it in the Home app using that
code, the same way you'd add any other HomeKit accessory. If you remove a
TV from your config later, it has to be removed from the Home app manually
too since Homebridge can't unpair it for you.

### Features

- **Multiple RM devices** configure several Broadlink RMs and assign each
  accessory to whichever one it's actually near.
- **Basic accessories** power on/off via a hex signal.
- **Dimmer lights** one hex signal per discrete brightness level
- **TVs** power on/off plus a usable remote (arrows, select, back, exit, info,
  volume, mute) in the iOS Remote app
- **Temperature/humidity sensor** polls the RM every 60 seconds, on by default.
- **ntfy.sh notifications** optional push notification the first time an RM
  device fails to connect.
- Fully configurable via the Homebridge Config UI X plugin settings form.

### Configuration

This plugin can be fully configured from the Homebridge Config UI X plugin
settings form.

#### config.json

If you'd rather edit the config file directly, here's an example
`config.json` platform block:

```json
{
  "platform": "BroadlinkRMBlaster",
  "ntfyTopic": "my-homebridge-alerts",
  "rmDevices": [
    {
      "name": "Default RM",
      "ip": "192.168.1.50",
      "enableTemperatureHumidity": true
    },
    {
      "name": "Bedroom RM",
      "ip": "192.168.1.60"
    }
  ],
  "accessories": [
    {
      "name": "Living Room Lamp",
      "rmDevice": "Default RM",
      "accessoryType": "light",
      "powerOnCode": "2600...",
      "powerOffCode": "2600..."
    },
    {
      "name": "Fan",
      "rmDevice": "Bedroom RM",
      "accessoryType": "fan",
      "powerOnCode": "2600..."
    }
  ],
  "dimmers": [
    {
      "name": "Bedroom Dimmer",
      "rmDevice": "Bedroom RM",
      "powerOnCode": "2600...",
      "powerOffCode": "2600...",
      "zeroPercentCode": "2600...",
      "hundredPercentCode": "2600...",
      "debounceSeconds": 0.5,
      "useLastKnownBrightness": true,
      "useDefaultBrightnessLevel": true,
      "defaultBrightnessLevel": 75,
      "useMaxBrightnessLevel": true,
      "maxBrightnessLevel": 50,
      "levels": [
        { "level": 25, "code": "2600..." },
        { "level": 50, "code": "2600..." },
        { "level": 75, "code": "2600..." }
      ]
    }
  ],
  "tvs": [
    {
      "name": "Living Room TV",
      "rmDevice": "Default RM",
      "powerOnCode": "2600...",
      "volumeUpCode": "2600...",
      "volumeDownCode": "2600...",
      "muteCode": "2600...",
      "arrowUpCode": "2600...",
      "selectCode": "2600..."
    }
  ]
}
```

- `ntfyTopic`: optional. If set, this plugin publishes a notification to
  `https://ntfy.sh/<topic>` the first time a given RM device fails to
  connect - subscribe to the same topic in the [ntfy](https://ntfy.sh) app to
  receive it. Only fires once per outage; it resets once that device
  connects successfully again. The temperature/humidity sensor also triggers
  this after 5 consecutive failed readings (see below), reusing the same
  once-per-outage behavior.
- `rmDevices`: at least one required. Each needs a unique `name` and `ip`;
  `enableTemperatureHumidity` (defaults to `true`) adds a temperature/humidity
  sensor accessory for that specific device. If a reading fails 5 times in a
  row, the sensor shows "No Response" in Home (rather than a frozen stale
  value) and, if `ntfyTopic` is set, sends a notification.
- `rmDevice` on every accessory/dimmer/TV below is a plain text field that
  must exactly match the `name` of one of the devices above. There's no
  live dropdown, since Homebridge's config UI can't populate one from
  sibling array data. Save your RM devices first, then reference them by
  name; a typo just makes that accessory get skipped with a warning in the
  log rather than silently misbehaving.
- `accessories[].powerOffCode`: optional; if omitted, the power-on signal is
  reused for both on and off (useful for toggle-only remotes).
- `dimmers[].powerOnCode` / `powerOffCode`: required fields, but currently
  unused by the plugin - power on/off is done with the resolved brightness
  level and `zeroPercentCode` instead, as an ongoing experiment to reduce RF
  traffic. Still required so this can be reverted without a config change.
- `dimmers[].defaultBrightnessLevel` / `maxBrightnessLevel`: independent target
  percentages, not tied to a specific configured level. The nearest configured
  signal is sent, but the percentage shown in Home stays the configured target.
- `dimmers[].hundredPercentCode`: required, like `zeroPercentCode`: the true,
  uncapped 100% signal, always reachable regardless of any max brightness cap.
- `dimmers[].debounceSeconds`: defaults to `0.5`. A slider drag fires many
  rapid updates; the actual signal only sends after this long of no movement.
- `tvs[].powerOnCode` is the only required TV field. Everything else
  (`powerOffCode`, `volumeUpCode`/`volumeDownCode`, `muteCode`,
  `arrowUpCode`/`arrowDownCode`/`arrowLeftCode`/`arrowRightCode`,
  `selectCode`, `infoCode`, `backCode`, `exitCode`) is optional; pressing a
  remote button with no signal configured for it just does nothing.
  `muteCode` is sent as-is for both muting and unmuting, since most remotes
  use a single toggle button rather than distinct on/off signals.

### Debugging

To send a single hex code straight to your RM, bypassing Homebridge/HomeKit
entirely (useful for isolating whether a signal behaves oddly on the device
itself vs. through the plugin), run this in the Homebridge Config UI X
terminal:

```bash
broadlink-rm-blaster <ip> <hexCode>
```

Run `broadlink-rm-blaster --help` for usage details.

## Credits

Inspired by [homebridge-broadlink-rm](https://github.com/kiwi-cam/homebridge-broadlink-rm#readme),
built on [kiwicam-broadlinkjs-rm](https://www.npmjs.com/package/kiwicam-broadlinkjs-rm)
for the underlying device communication.

[LICENSE](https://github.com/LuudJacobs/homebridge-broadlink-rm-blaster/blob/main/LICENSE) · [CHANGELOG](https://github.com/LuudJacobs/homebridge-broadlink-rm-blaster/blob/main/CHANGELOG.md)
