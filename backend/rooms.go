package main

import(
	"sync"
)

var (
	roomsMu sync.Mutex
	rooms = make(map[string]*Hub)
)

func getRoomHub(room string) *Hub {

	roomsMu.Lock()
	defer roomsMu.Unlock()

	hub, valid := rooms[room]
	if !valid {
		hub = NewHub()
		rooms[room] = hub
		go hub.Run()
	}
	return hub
}