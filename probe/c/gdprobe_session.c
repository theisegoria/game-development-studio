/*
 * gdprobe live sessions. C99 plus POSIX sockets; compile alongside gdprobe.c.
 *
 * The harness listens on a Unix socket in a directory only this user can
 * enter, and launches the engine with the socket path and a one-time token.
 * The engine connects, says hello with the token, and is then polled once
 * per frame. Requests are newline-delimited flat JSON written by the harness;
 * this file parses exactly that shape and nothing more general.
 *
 * Pixels never travel over the socket. A snapshot is written as a PNG into
 * the session directory under a name the harness chose and this file
 * validates character by character, and only the name goes back.
 */

#define _POSIX_C_SOURCE 200809L

#include "gdprobe.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)

gdprobe_session *gdprobe_session_open(gdprobe_status *out_status) {
  if (out_status) *out_status = GDPROBE_NOT_ATTACHED;
  return NULL;
}
gdprobe_status gdprobe_session_poll(gdprobe_session *session, const gdprobe_session_handlers *handlers, void *user, int32_t frame_index) {
  (void) session; (void) handlers; (void) user; (void) frame_index;
  return GDPROBE_NOT_ATTACHED;
}
int gdprobe_session_should_advance(gdprobe_session *session) { (void) session; return 1; }
int gdprobe_session_closed(const gdprobe_session *session) { (void) session; return 1; }
void gdprobe_session_close(gdprobe_session *session) { (void) session; }

#else

#include <errno.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

int gdprobe__write_png_rgba(const char *path, uint32_t width, uint32_t height,
                            const unsigned char *pixels, size_t row_stride);

#define SESSION_BUFFER 65536
#define QUERY_ANSWER_CAPACITY 262144

struct gdprobe_session {
  int fd;
  int closed;
  int paused;
  long steps;
  long pending_step_id;
  char dir[1024];
  char buffer[SESSION_BUFFER];
  size_t used;
};

static int send_all(gdprobe_session *session, const char *data, size_t length) {
  while (length > 0) {
    ssize_t sent = send(session->fd, data, length, 0);
    if (sent < 0) {
      if (errno == EINTR) continue;
      session->closed = 1;
      return -1;
    }
    data += sent;
    length -= (size_t) sent;
  }
  return 0;
}

/* Escape a C string as JSON into `out`; returns 0 when it did not fit. */
static int json_escape(const char *text, char *out, size_t capacity) {
  size_t length = 0;
  for (const unsigned char *cursor = (const unsigned char *) text; *cursor; cursor += 1) {
    char escaped[8];
    const char *piece;
    size_t piece_length;
    if (*cursor == '"' || *cursor == '\\') { escaped[0] = '\\'; escaped[1] = (char) *cursor; piece = escaped; piece_length = 2; }
    else if (*cursor < 0x20) { snprintf(escaped, sizeof escaped, "\\u%04x", *cursor); piece = escaped; piece_length = 6; }
    else { escaped[0] = (char) *cursor; piece = escaped; piece_length = 1; }
    if (length + piece_length + 1 > capacity) return 0;
    memcpy(out + length, piece, piece_length);
    length += piece_length;
  }
  out[length] = '\0';
  return 1;
}

static void reply_error(gdprobe_session *session, long id, const char *message) {
  char escaped[512];
  if (!json_escape(message, escaped, sizeof escaped)) strcpy(escaped, "error");
  char line[700];
  int length = snprintf(line, sizeof line, "{\"id\":%ld,\"ok\":false,\"error\":\"%s\"}\n", id, escaped);
  if (length > 0 && (size_t) length < sizeof line) send_all(session, line, (size_t) length);
}

static void reply_frame(gdprobe_session *session, long id, int32_t frame_index) {
  char line[128];
  int length = snprintf(line, sizeof line, "{\"id\":%ld,\"ok\":true,\"result\":{\"frameIndex\":%ld,\"paused\":%s}}\n",
                        id, (long) frame_index, session->paused ? "true" : "false");
  if (length > 0 && (size_t) length < sizeof line) send_all(session, line, (size_t) length);
}

/*
 * Find `"key":` in a flat JSON object and read its value. Strings are
 * unescaped (\" \\ \n \t \/ and \u00XX); numbers are copied as text. The
 * harness writes these requests, so this reader is deliberately narrow.
 */
static int json_field(const char *line, const char *key, char *out, size_t capacity) {
  char needle[64];
  if (snprintf(needle, sizeof needle, "\"%s\":", key) >= (int) sizeof needle) return 0;
  const char *at = strstr(line, needle);
  if (!at) return 0;
  at += strlen(needle);
  size_t length = 0;
  if (*at == '"') {
    at += 1;
    while (*at && *at != '"') {
      char c = *at++;
      if (c == '\\') {
        char next = *at++;
        if (next == 'n') c = '\n';
        else if (next == 't') c = '\t';
        else if (next == 'u') {
          unsigned value = 0;
          for (int digit = 0; digit < 4 && *at; digit += 1, at += 1) {
            char h = *at;
            value = value * 16u + (unsigned) (h >= '0' && h <= '9' ? h - '0' : h >= 'a' && h <= 'f' ? h - 'a' + 10 : h >= 'A' && h <= 'F' ? h - 'A' + 10 : 0);
          }
          c = value < 0x80 ? (char) value : '?';
        } else if (next) c = next;
        else return 0;
      }
      if (length + 1 >= capacity) return 0;
      out[length++] = c;
    }
    if (*at != '"') return 0;
  } else {
    while (*at && (*at == '-' || (*at >= '0' && *at <= '9'))) {
      if (length + 1 >= capacity) return 0;
      out[length++] = *at++;
    }
    if (length == 0) return 0;
  }
  out[length] = '\0';
  return 1;
}

/* Only `snapshots/<4 to 8 digits>.png`: no separators, no dots, no escape. */
static int snapshot_name_ok(const char *name) {
  if (strncmp(name, "snapshots/", 10) != 0) return 0;
  const char *digits = name + 10;
  size_t count = 0;
  while (digits[count] >= '0' && digits[count] <= '9') count += 1;
  return count >= 4 && count <= 8 && strcmp(digits + count, ".png") == 0;
}

static void handle(gdprobe_session *session, const char *line, const gdprobe_session_handlers *handlers,
                   void *user, int32_t frame_index) {
  char id_text[24];
  char op[32];
  if (!json_field(line, "id", id_text, sizeof id_text) || !json_field(line, "op", op, sizeof op)) return;
  long id = strtol(id_text, NULL, 10);

  if (strcmp(op, "snapshot") == 0) {
    char name[64];
    if (!json_field(line, "path", name, sizeof name) || !snapshot_name_ok(name)) { reply_error(session, id, "snapshot path refused"); return; }
    if (!handlers || !handlers->snapshot) { reply_error(session, id, "this engine does not provide snapshots"); return; }
    const unsigned char *pixels = NULL;
    uint32_t width = 0, height = 0;
    size_t row_stride = 0;
    if (handlers->snapshot(user, &pixels, &width, &height, &row_stride) != GDPROBE_OK || !pixels || !width || !height) {
      reply_error(session, id, "the engine had no frame to give"); return;
    }
    if (row_stride < (size_t) width * 4) { reply_error(session, id, "row stride is smaller than width * 4"); return; }
    char path[1200];
    if (snprintf(path, sizeof path, "%s/%s", session->dir, name) >= (int) sizeof path) { reply_error(session, id, "session path too long"); return; }
    if (gdprobe__write_png_rgba(path, width, height, pixels, row_stride) != 0) { reply_error(session, id, "could not write the snapshot"); return; }
    char reply[256];
    int length = snprintf(reply, sizeof reply,
                          "{\"id\":%ld,\"ok\":true,\"result\":{\"path\":\"%s\",\"frameIndex\":%ld,\"width\":%lu,\"height\":%lu}}\n",
                          id, name, (long) frame_index, (unsigned long) width, (unsigned long) height);
    if (length > 0 && (size_t) length < sizeof reply) send_all(session, reply, (size_t) length);
  } else if (strcmp(op, "state_query") == 0) {
    char query[1024];
    if (!json_field(line, "query", query, sizeof query)) { reply_error(session, id, "state_query needs a query"); return; }
    if (!handlers || !handlers->state_query) { reply_error(session, id, "this engine does not answer state queries"); return; }
    char *answer = malloc(QUERY_ANSWER_CAPACITY);
    if (!answer) { reply_error(session, id, "out of memory"); return; }
    answer[0] = '\0';
    if (handlers->state_query(user, query, answer, QUERY_ANSWER_CAPACITY) != GDPROBE_OK || !answer[0]) {
      reply_error(session, id, "the engine declined the query");
    } else {
      answer[QUERY_ANSWER_CAPACITY - 1] = '\0';
      /* The engine's JSON is passed through; the harness parses and bounds it. */
      for (char *cursor = answer; *cursor; cursor += 1) if (*cursor == '\n' || *cursor == '\r') *cursor = ' ';
      char head[96];
      int length = snprintf(head, sizeof head, "{\"id\":%ld,\"ok\":true,\"result\":", id);
      if (length > 0) {
        send_all(session, head, (size_t) length);
        send_all(session, answer, strlen(answer));
        send_all(session, "}\n", 2);
      }
    }
    free(answer);
  } else if (strcmp(op, "pause") == 0) {
    session->paused = 1;
    session->steps = 0;
    reply_frame(session, id, frame_index);
  } else if (strcmp(op, "resume") == 0) {
    session->paused = 0;
    session->steps = 0;
    reply_frame(session, id, frame_index);
  } else if (strcmp(op, "step") == 0) {
    char frames[16];
    long count = json_field(line, "frames", frames, sizeof frames) ? strtol(frames, NULL, 10) : 1;
    if (count < 1 || count > 10000) { reply_error(session, id, "step frames must be 1 to 10000"); return; }
    if (session->pending_step_id >= 0) { reply_error(session, id, "a step is already in progress"); return; }
    session->paused = 1;
    session->steps = count;
    session->pending_step_id = id; /* answered once the frames have been rendered */
  } else if (strcmp(op, "bye") == 0) {
    reply_frame(session, id, frame_index);
    session->closed = 1;
  } else {
    reply_error(session, id, "unknown request");
  }
}

gdprobe_session *gdprobe_session_open(gdprobe_status *out_status) {
  const char *socket_path = getenv("GAME_DEV_SESSION_SOCKET");
  const char *token = getenv("GAME_DEV_SESSION_TOKEN");
  const char *dir = getenv("GAME_DEV_SESSION_DIR");
  if (!socket_path || !token || !dir || !socket_path[0] || !token[0] || !dir[0]) {
    if (out_status) *out_status = GDPROBE_NOT_ATTACHED;
    return NULL;
  }
  struct sockaddr_un address;
  memset(&address, 0, sizeof address);
  address.sun_family = AF_UNIX;
  if (strlen(socket_path) >= sizeof address.sun_path || strlen(dir) >= 1024 || strlen(token) > 128) {
    if (out_status) *out_status = GDPROBE_ERR_LIMIT;
    return NULL;
  }
  memcpy(address.sun_path, socket_path, strlen(socket_path) + 1);

  gdprobe_session *session = calloc(1, sizeof *session);
  if (!session) { if (out_status) *out_status = GDPROBE_ERR_MEMORY; return NULL; }
  session->pending_step_id = -1;
  memcpy(session->dir, dir, strlen(dir) + 1);
  session->fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (session->fd < 0 || connect(session->fd, (struct sockaddr *) &address, sizeof address) != 0) {
    if (session->fd >= 0) close(session->fd);
    free(session);
    if (out_status) *out_status = GDPROBE_ERR_IO;
    return NULL;
  }
  char hello[256];
  int length = snprintf(hello, sizeof hello, "{\"op\":\"hello\",\"protocol\":\"game_dev.session.v1\",\"token\":\"%s\"}\n", token);
  if (length <= 0 || (size_t) length >= sizeof hello || send_all(session, hello, (size_t) length) != 0) {
    close(session->fd);
    free(session);
    if (out_status) *out_status = GDPROBE_ERR_IO;
    return NULL;
  }
  if (out_status) *out_status = GDPROBE_OK;
  return session;
}

gdprobe_status gdprobe_session_poll(gdprobe_session *session, const gdprobe_session_handlers *handlers,
                                    void *user, int32_t frame_index) {
  if (!session) return GDPROBE_ERR_ARGUMENT;
  if (session->closed) return GDPROBE_OK;

  /* A finished step is answered at the first poll after its last frame. */
  if (session->pending_step_id >= 0 && session->steps == 0) {
    reply_frame(session, session->pending_step_id, frame_index);
    session->pending_step_id = -1;
  }

  for (;;) {
    struct pollfd ready = { session->fd, POLLIN, 0 };
    int polled = poll(&ready, 1, 0);
    if (polled < 0 && errno == EINTR) continue;
    if (polled <= 0) break;
    if (session->used >= sizeof session->buffer - 1) { session->closed = 1; return GDPROBE_ERR_LIMIT; }
    ssize_t received = recv(session->fd, session->buffer + session->used, sizeof session->buffer - 1 - session->used, 0);
    if (received < 0 && errno == EINTR) continue;
    if (received <= 0) { session->closed = 1; break; }
    session->used += (size_t) received;
    session->buffer[session->used] = '\0';

    char *start = session->buffer;
    char *newline;
    while ((newline = strchr(start, '\n')) != NULL && !session->closed) {
      *newline = '\0';
      handle(session, start, handlers, user, frame_index);
      start = newline + 1;
    }
    size_t remaining = session->used - (size_t) (start - session->buffer);
    memmove(session->buffer, start, remaining);
    session->used = remaining;
    session->buffer[session->used] = '\0';
    if (session->closed) break;
  }
  return GDPROBE_OK;
}

int gdprobe_session_should_advance(gdprobe_session *session) {
  if (!session || session->closed || !session->paused) return 1;
  if (session->steps > 0) {
    session->steps -= 1;
    return 1;
  }
  return 0;
}

int gdprobe_session_closed(const gdprobe_session *session) {
  return !session || session->closed;
}

void gdprobe_session_close(gdprobe_session *session) {
  if (!session) return;
  if (session->fd >= 0) close(session->fd);
  free(session);
}

#endif
