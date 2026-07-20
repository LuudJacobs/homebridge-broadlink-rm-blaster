# homebridge-broadlink-rm4pro-blaster

Blast RF and IR signals from a Broadlink RM4 Pro using Homebridge. This plugin sends
pre-recorded hex signals to a known device IP — it does not learn signals or
autodiscover the Broadlink device.

## Current feature set (v0.3.0)

- A "basic accessory" type exposed as a Light, Switch, Outlet, or Fan in Apple Home.
- A dimmer light: one hex signal per discrete brightness level (plus a required 0%
  signal). A live slider request is matched to the nearest configured level. A
  configured max brightness percentage remaps the 0-100% slider onto that physical
  range (e.g. max=50%: sliding to 100% sends the 50% signal, sliding to 50% sends the
  nearest level to 25%). Turning on resolves an assumed brightness in this order:
  last-known (if enabled) → configured default percentage → configured max
  percentage → highest configured level. The default percentage is on the same
  logical 0-100 scale as the slider, so it's remapped through the configured max
  too — it can never physically exceed the max cap.
- Power On/Off (and brightness) is sent as a hex signal to the RM4 Pro. Since a
  blaster has no feedback, the state shown in Home is assumed, not a real reading.
- A temperature/humidity sensor accessory, on by default, polling the RM4 Pro every
  60 seconds. Not all RM4 Pro units actually report real sensor data — if yours
  doesn't, it shows "No Response" in Home rather than a fake reading. Turn it off
  with `showTemperatureHumidity: false` if you don't want it at all.

Not yet implemented: TV accessory.

## Installation

```bash
npm install -g homebridge-broadlink-rm4pro-blaster
```

## Configuration

Example `config.json` platform block:

```json
{
  "platform": "BroadlinkRM4ProBlaster",
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
      "zeroPercentCode": "2600...",
      "useLastKnownBrightness": true,
      "useDefaultBrightnessLevel": true,
      "defaultBrightnessLevel": 75,
      "useMaxBrightnessLevel": true,
      "maxBrightnessLevel": 50,
      "levels": [
        { "level": 25, "code": "2600..." },
        { "level": 50, "code": "2600..." },
        { "level": 75, "code": "2600..." },
        { "level": 100, "code": "2600..." }
      ]
    }
  ]
}
```

- `defaultIp`: IP address of your Broadlink RM4 Pro, used when an accessory
  doesn't specify its own `ip`.
- `showTemperatureHumidity`: defaults to `true`. Set to `false` to remove the
  sensor accessory entirely. `temperatureSensorIp` overrides `defaultIp` for it.
- `accessories[].powerOffCode`: optional; if omitted, the power-on signal is
  reused for both on and off (useful for toggle-only remotes).
- `dimmers[].powerOnCode`: optional; if omitted, turning on just sends the
  resolved brightness level's own signal.
- `dimmers[].defaultBrightnessLevel` / `maxBrightnessLevel`: independent target
  percentages, not tied to a specific configured level — the nearest configured
  signal is sent, but the percentage shown in Home stays the configured target.

Config can also be edited through `homebridge-config-ui-x`.
