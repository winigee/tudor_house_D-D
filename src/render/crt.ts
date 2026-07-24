// Optional WebGL post-pass: scanlines, gentle barrel distortion, glow
// and vignette over the internal canvas. The game must run with this
// disabled; any failure here falls back to the plain 2D upscale.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;

vec2 barrel(vec2 uv) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  return uv + c * r2 * 0.08;
}

void main() {
  vec2 uv = barrel(vec2(vUv.x, 1.0 - vUv.y));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 col = texture2D(uTex, uv).rgb;
  // Soft glow from neighbours.
  vec2 px = 1.0 / uRes;
  vec3 glow = texture2D(uTex, uv + vec2(px.x, 0.0)).rgb
            + texture2D(uTex, uv - vec2(px.x, 0.0)).rgb
            + texture2D(uTex, uv + vec2(0.0, px.y)).rgb
            + texture2D(uTex, uv - vec2(0.0, px.y)).rgb;
  col += glow * 0.12;
  // Scanlines follow the internal resolution.
  float scan = 0.82 + 0.18 * sin(uv.y * uRes.y * 3.14159 * 2.0);
  col *= scan;
  // Vignette.
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.55;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class CrtPass {
  private gl: WebGLRenderingContext;
  private texture: WebGLTexture;
  private resLoc: WebGLUniformLocation;

  private constructor(gl: WebGLRenderingContext, texture: WebGLTexture, resLoc: WebGLUniformLocation) {
    this.gl = gl;
    this.texture = texture;
    this.resLoc = resLoc;
  }

  /** Returns null when WebGL is unavailable; caller falls back to 2D. */
  static create(canvas: HTMLCanvasElement): CrtPass | null {
    try {
      const gl = canvas.getContext('webgl', { antialias: false });
      if (!gl) return null;
      const compile = (type: number, src: string): WebGLShader => {
        const sh = gl.createShader(type)!;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
        }
        return sh;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed');
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const resLoc = gl.getUniformLocation(prog, 'uRes');
      if (!resLoc) throw new Error('missing uniform');
      return new CrtPass(gl, texture, resLoc);
    } catch (err) {
      console.warn('CRT pass unavailable, falling back to plain upscale', err);
      return null;
    }
  }

  present(source: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.uniform2f(this.resLoc, source.width, source.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
