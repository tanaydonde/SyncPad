package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"github.com/gorilla/websocket"
)

type EditMsg struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {return true},
}

func wsHandler(w http.ResponseWriter, r *http.Request){
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("upgrade error:", err)
		return
	}

	room := r.URL.Query().Get("room")
	if room == "" {
		room = "default"
	}

	hub := getRoomHub(room)

	fmt.Println("ws client connected to room:", room)
	hub.register <- conn

	defer func() { hub.unregister <- conn}()

	for {
		_, msg, err := conn.ReadMessage()

		if err != nil {
			fmt.Println("read error:", err)
			hub.unregister <- conn
			return
		}

		var em EditMsg
		if err := json.Unmarshal(msg, &em); err != nil {
			hub.broadcast <- string(msg)
			continue
		}

		if em.Type == "edit" {
			hub.broadcast <- em.Text
		}
	}
}