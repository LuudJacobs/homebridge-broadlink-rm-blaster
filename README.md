# Broadlink RM Blaster 1.3.1

**This Homebridge plugin has been 100% vibe coded with Claude.**

Blast RF and IR signals from Broadlink RM devices using Homebridge. Sends
pre-recorded hex codes to a known device IP; does not learn signals or
autodiscover devices. To capture hex codes from your own remotes, see
[learn-broadlink-rm4-codes](https://github.com/LuudJacobs/learn-broadlink-rm4-codes).

## Requirements

- A Broadlink RM device, unlocked using the official Broadlink app

## Installation

```bash
npm install homebridge-broadlink-rm-blaster
hb-service add homebridge-broadlink-rm-blaster
```

## Features

- **Multiple RM devices** configure several Broadlink RMs and assign each accessory to whichever one
- **Basic accessories** power on/off
- **Dimmer lights** one signal per discrete brightness level
- **TVs** power on/off plus a usable remote in the iOS Remote app
- **Temperature/humidity sensor** optionally expose sensor data
- **ntfy.sh notifications** push notification when a RM fails to connect
- **MQTT publishing** optionally publish sensor data to a MQTT broker
- Fully configurable via the Homebridge Config UI X plugin settings form

## Configuration

This plugin can be fully configured from the Homebridge Config UI X plugin
settings form.

## Debugging

To send a single hex code straight to your RM, bypassing Homebridge/HomeKit entirely run this in the Homebridge shell:

```bash
broadlink-rm-blaster <ip> <hexCode>
```

Run `broadlink-rm-blaster --help` for usage details.

## Credits

Inspired by [homebridge-broadlink-rm](https://github.com/kiwi-cam/homebridge-broadlink-rm#readme),
built on [kiwicam-broadlinkjs-rm](https://www.npmjs.com/package/kiwicam-broadlinkjs-rm)
for the underlying device communication.

## Links

[LICENSE](https://github.com/LuudJacobs/homebridge-broadlink-rm-blaster/blob/main/LICENSE) · [CHANGELOG](https://github.com/LuudJacobs/homebridge-broadlink-rm-blaster/blob/main/CHANGELOG.md)
