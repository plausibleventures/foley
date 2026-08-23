/**
 * An `AudioBuffer` written out as a RIFF/WAVE file.
 *
 * 16-bit PCM rather than 32-bit float, because the file leaving this page is going into a game
 * engine, a design tool or an `<audio>` tag, and every one of those reads 16-bit. The one thing
 * worth being careful about is the conversion: a float of exactly 1.0 scaled by 32768 is 32768,
 * which does not fit in a signed 16-bit word and wraps to full-scale *negative* — a click on the
 * loudest sample of the loudest sound, which is the worst possible place for one.
 */

/** Peak of the buffer, so the UI can say how much headroom is left before the file clips. */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const magnitude = Math.abs(data[i]!);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

/**
 * Trim the silence off both ends, keeping `padSec` at the tail.
 *
 * Both halves matter and they matter for different reasons. Every sound is rendered into a
 * context long enough for the longest possible release, so most end with most of a second of
 * nothing — and a file that is four fifths silence is a file whose waveform is unreadable and
 * whose size is a lie. The head is worse: a sound triggered from a click handler with twenty
 * milliseconds of silence in front of it is twenty milliseconds of latency that nobody will ever
 * find, because the file looks correct and plays correct and simply arrives late.
 */
export function trimTail(buffer: AudioBuffer, floor = 0.0005, padSec = 0.02): AudioBuffer {
  const channels = buffer.numberOfChannels;
  let last = 0;
  let first = buffer.length;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if (Math.abs(data[i]!) > floor) {
        if (i > last) last = i;
        break;
      }
    }
    for (let i = 0; i < data.length; i += 1) {
      if (Math.abs(data[i]!) > floor) {
        if (i < first) first = i;
        break;
      }
    }
  }
  if (first >= buffer.length) return buffer;
  const start = Math.max(0, first - 2);
  const end = Math.min(buffer.length, last + 1 + Math.round(padSec * buffer.sampleRate));
  const length = Math.max(1, end - start);
  if (start === 0 && end >= buffer.length) return buffer;
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: buffer.sampleRate });
  for (let channel = 0; channel < channels; channel += 1) {
    out.copyToChannel(buffer.getChannelData(channel).subarray(start, start + length), channel);
  }
  return out;
}

/** Scale the whole buffer so its peak lands on `target`. A no-op on silence. */
export function normalise(buffer: AudioBuffer, target: number): AudioBuffer {
  const peak = peakOf(buffer);
  if (peak <= 0.0001) return buffer;
  const scale = target / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) data[i] = data[i]! * scale;
  }
  return buffer;
}

export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = frames * channels * 2;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  const sources: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel += 1) sources.push(buffer.getChannelData(channel));

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, sources[channel]![frame]!));
      // 32767 on the positive side, 32768 on the negative: the asymmetry is the format's, and
      // multiplying both by 32768 is what wraps a full-scale peak into a full-scale trough.
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(out);
}

export function download(name: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
