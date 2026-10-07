# Data-logger software overview

A short description of the DL-7 field data logger, for anyone planning work on it. Figures are
programme targets, not measured values.

- **Purpose** — records sensor channels in harsh field conditions and hands the data to a ground station.
- **Inputs** — 8 analogue channels (0–10 V) and 2 serial sensor ports; sample rate 1 Hz to 1 kHz per channel.
- **Storage** — removable flash card; records are written in blocks with a checksum; the logger must not lose more than the last block on power loss.
- **Time** — every record carries a UTC timestamp; drift must stay under 2 s per day without an external time source.
- **Download** — over a wired link to the ground-station software, with a file integrity check.
- **Environment** — operates from −30 °C to +60 °C on a 9–32 V supply.
- **Software parts** — acquisition, storage manager, time keeping, download service, self-test at power-up.
