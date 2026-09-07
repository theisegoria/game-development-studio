#version 450
layout(location = 0) flat in uint vObject;
layout(location = 0) out vec4 color;
layout(location = 1) out uint objectId;
layout(push_constant) uniform Push { float brightness; } push;
void main() {
  // Object 1 red (shifted by brightness), object 2 blue. Flat and unlit, so
  // the output is deterministic on a given device: no interpolation, no MSAA.
  color = vObject == 1u
    ? vec4((200.0 + push.brightness) / 255.0, 40.0 / 255.0, 20.0 / 255.0, 1.0)
    : vec4(20.0 / 255.0, 40.0 / 255.0, 200.0 / 255.0, 1.0);
  objectId = vObject;
}
