# Broadlink RM Blaster 1.4.0

**This Homebridge plugin has been 100% vibe coded with Claude.**

Blast RF and IR signals from Broadlink RM devices using Homebridge. Sends
hex codes to a known device IP; does not autodiscover devices. Codes can be
learned interactively via the included `broadlink-rm-learner` command (see
[Learning hex codes](#learning-hex-codes)).

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
- **Interactive code learning** guided walkthrough to learn codes straight from your remote and add them to your config (`broadlink-rm-learner`)
- Fully configurable via the Homebridge Config UI X plugin settings form

## Configuration

This plugin can be fully configured from the Homebridge Config UI X plugin
settings form.

## Learning hex codes

To learn codes straight from a remote and add the resulting accessory to
your config, run this in the Homebridge shell:

```bash
broadlink-rm-learner
```

Guided prompts walk you through picking an RM device and learning each
signal for a Basic Accessory, TV, or Dimmer Light. For RF remotes, enter the
frequency in MHz when asked (defaults to 433.92, the most common one) rather
than holding the button for the RM to detect it - more reliable in practice.
Backs up `config.json` to `config.json.backup` once per session before
writing anything. Run `broadlink-rm-learner --help` for usage details.

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
