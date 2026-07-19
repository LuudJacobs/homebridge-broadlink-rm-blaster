# homebridge-broadlink-rm4pro-blaster

Blast RF and IR signals from a Broadlink RM4 Pro using Homebridge. This plugin sends
pre-recorded hex signals to a known device IP — it does not learn signals or
autodiscover the Broadlink device.

## Current feature set (v0.1)

- A "basic accessory" type exposed as a Light, Switch, Outlet, or Fan in Apple Home.
- Power On/Off is sent as a hex signal to the RM4 Pro. Since a blaster has no
  feedback, the on/off state shown in Home is an assumed state, not a real reading.

Not yet implemented: TV accessory, dimmer light.

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
  ]
}
```

- `defaultIp`: IP address of your Broadlink RM4 Pro, used when an accessory
  doesn't specify its own `ip`.
- `accessories[].powerOffCode`: optional; if omitted, the power-on signal is
  reused for both on and off (useful for toggle-only remotes).

Config can also be edited through `homebridge-config-ui-x`.
