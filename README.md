# homebridge-broadlink-rm-blaster

Blast RF and IR signals from a Broadlink RM using Homebridge. Inspired by
[homebridge-broadlink-rm](https://github.com/kiwi-cam/homebridge-broadlink-rm#readme),
built on [kiwicam-broadlinkjs-rm](https://www.npmjs.com/package/kiwicam-broadlinkjs-rm)
for the underlying device communication.

This plugin sends pre-recorded hex signals to a known device IP — it does not learn
signals or autodiscover the Broadlink device. To capture hex codes from your own
remotes, see [learn-broadlink-rm4-codes](https://github.com/LuudJacobs/learn-broadlink-rm4-codes).

> This project was vibe coded using Claude.

## Usage

- Basic accessories (Light, Switch, Outlet, Fan) — power on/off via a hex signal.
- Dimmer lights — one hex signal per discrete brightness level, with optional
  default/max brightness and "use last known brightness" on power on.
- Temperature/humidity sensor — polls the RM every 60 seconds, on by default.
- Fully configurable via the Homebridge Config UI X plugin settings form.

## Setup

```bash
npm install -g homebridge-broadlink-rm-blaster
```

Your Broadlink RM must be unlocked using the official Broadlink app before this
plugin (or any third-party integration) can control it — new devices ship locked,
which blocks local API access.

## Configuration

Example `config.json` platform block:

```json
{
  "platform": "BroadlinkRMBlaster",
  "defaultIp": "192.168.1.50",
  "showTemperatureHumidity": true,
  "accessories": [
    {
      "name": "Living Room Lamp",
      "accessoryType": "light",
      "powerOnCode": "2600...",
      "powerOffCode": "2600..."
    },
    {
      "name": "Fan",
      "ip": "192.168.1.51",
      "accessoryType": "fan",
      "powerOnCode": "2600..."
    }
  ],
  "dimmers": [
    {
      "name": "Bedroom Dimmer",
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
  ]
}
```

- `defaultIp`: IP address of your Broadlink RM, used when an accessory
  doesn't specify its own `ip`.
- `showTemperatureHumidity`: defaults to `true`. Set to `false` to remove the
  sensor accessory entirely. `temperatureSensorIp` overrides `defaultIp` for it.
- `accessories[].powerOffCode`: optional; if omitted, the power-on signal is
  reused for both on and off (useful for toggle-only remotes).
- `dimmers[].powerOnCode` / `powerOffCode`: required fields, but currently
  unused by the plugin - power on/off is done with the resolved brightness
  level and `zeroPercentCode` instead, as an ongoing experiment to reduce RF
  traffic. Still required so this can be reverted without a config change.
- `dimmers[].defaultBrightnessLevel` / `maxBrightnessLevel`: independent target
  percentages, not tied to a specific configured level — the nearest configured
  signal is sent, but the percentage shown in Home stays the configured target.
- `dimmers[].hundredPercentCode`: required, like `zeroPercentCode` — the true,
  uncapped 100% signal, always reachable regardless of any max brightness cap.
- `dimmers[].debounceSeconds`: defaults to `0.5`. A slider drag fires many
  rapid updates; the actual signal only sends after this long of no movement.

Config can also be edited through `homebridge-config-ui-x`.

## Debugging

To send a single hex code straight to your RM, bypassing Homebridge/HomeKit
entirely (useful for isolating whether a signal behaves oddly on the device
itself vs. through the plugin):

```bash
npm run send-code -- <ip> <hexCode>
```
