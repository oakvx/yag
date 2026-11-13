"""Bounded, priority-aware admission and least-busy multi-node selection."""
from contextlib import contextmanager
import threading
import time


class Busy(Exception):
    pass


class Scheduler:
    def __init__(self, max_active=4, max_waiting=16, wait_seconds=15):
        if not 1 <= max_active <= 32 or not 0 <= max_waiting <= 128:
            raise ValueError("invalid scheduler limits")
        self.max_active = max_active
        self.max_waiting = max_waiting
        self.wait_seconds = wait_seconds
        self.lock = threading.Condition()
        self.active = 0
        self.per_client = {}
        self.per_node = {}
        self.waiters = []
        self.sequence = 0

    def snapshot(self):
        with self.lock:
            return {"max_active": self.max_active, "active": self.active,
                    "queued": len(self.waiters), "max_waiting": self.max_waiting,
                    "per_node": dict(self.per_node)}

    @contextmanager
    def slot(self, client_id, priority, client_limit):
        with self.lock:
            self.sequence += 1
            ticket = (-priority, self.sequence, client_id)
            if len(self.waiters) >= self.max_waiting:
                raise Busy("Inference queue is full")
            self.waiters.append(ticket)
            if not hasattr(self, "_limits"):
                self._limits = {}
            self._limits[client_id] = client_limit
            deadline = time.monotonic() + self.wait_seconds
            acquired = False
            try:
                while not acquired:
                    eligible = [item for item in self.waiters
                                if self.per_client.get(item[2], 0) <
                                (client_limit if item[2] == client_id else
                                 self.per_client_limits.get(item[2], 2))]
                    selected = min(eligible) if eligible else None
                    if selected == ticket and self.active < self.max_active:
                        self.waiters.remove(ticket)
                        self.active += 1
                        self.per_client[client_id] = self.per_client.get(client_id, 0) + 1
                        acquired = True
                        break
                    left = deadline - time.monotonic()
                    if left <= 0:
                        raise Busy("Inference queue wait timed out")
                    self.lock.wait(min(left, 0.5))
            finally:
                if not acquired and ticket in self.waiters:
                    self.waiters.remove(ticket)
                    self.lock.notify_all()
        try:
            yield
        finally:
            with self.lock:
                self.active -= 1
                self.per_client[client_id] -= 1
                if not self.per_client[client_id]:
                    del self.per_client[client_id]
                self.lock.notify_all()

    @property
    def per_client_limits(self):
        return getattr(self, "_limits", {})

    def choose_node(self, nodes, model):
        matches = [node for node in nodes if node["enabled"] and model in node["models"]]
        if not matches:
            return None
        with self.lock:
            choice = min(matches, key=lambda node: (
                self.per_node.get(node["id"], 0), node["id"]))
            self.per_node[choice["id"]] = self.per_node.get(choice["id"], 0) + 1
        return choice

    def release_node(self, identity):
        with self.lock:
            self.per_node[identity] = max(self.per_node.get(identity, 1) - 1, 0)
