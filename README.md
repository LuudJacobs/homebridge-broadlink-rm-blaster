# Broadlink RM Blaster 1.6.0

**This Homebridge plugin has been 100% vibe coded with Claude.**

Blast RF and IR signals from Broadlink RM devices using Homebridge. Sends
hex codes to a known device IP; this plugin does not autodiscover devices.
Codes can be learned interactively via the included `broadlink-rm-learner`
command (see [Learning hex codes](#learning-hex-codes)).

## Requirements

- A Broadlink RM device, unlocked using the official Broadlink app
- A fixed IP for the RM device, since the plugin does no autodiscovery

## Installation

```bash
npm install homebridge-broadlink-rm-blaster
hb-service add homebridge-broadlink-rm-blaster
```

## Features

- **Multiple RM devices** configure several Broadlink RMs and assign each accessory to whichever one
- **Interactive code learning** learn codes straight from your remote and add them to your config
- **Simple on/off accessories** power on/off
- **Advanced accessories** one press sends multiple signals in sequence, with a configurable timeout between them
- **Dimmer lights** one signal per discrete brightness level
- **Fans** speed control, optional swing, and any number of extra modes (e.g. heat, cooler) as switches or sliders
- **TVs** power on/off plus a usable remote in the iOS Remote app
- **Temperature/humidity sensor** optionally expose sensor data
- **ntfy.sh notifications** push notification when a RM fails to connect
- **MQTT publishing** optionally publish sensor data to a MQTT broker
- **Fully configurable** via the Homebridge Config UI X plugin settings form

## Configuration

This plugin can be fully configured from the Homebridge Config UI X plugin
settings form.

## Learning hex codes

To learn codes straight from a remote and add the resulting accessory to
your config, run this in the Homebridge shell:

```bash
broadlink-rm-learner
```

Run `broadlink-rm-learner --help` for usage details. Advanced Accessories
(multiple signals per press) and Fans (speed levels, modes, swing) can be
learned too, alongside Simple On/Off Accessories, TVs, and Dimmer Lights.
There's also a "just show hex code" option that captures a single signal
and prints it for copy/pasting, without saving anything.

Backs up `config.json` to `config.json.backup` once per session before writing anything.

## Managing accessories

To rename, remove, or reset an accessory, run this in the Homebridge shell:

```bash
broadlink-rm-manager
```

Reset clears an accessory's remembered state. This plugin never reads
anything back from a device, so if a fan is used from its own remote what
HomeKit shows can drift from what the device is actually doing. Resetting
puts everything back to off/0 without sending any signals, so the two line
up again.

Stop Homebridge before using it: Homebridge rewrites its own accessory
cache while running and would overwrite a reset. Changes are written when
you quit, and `config.json` is backed up first.

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
