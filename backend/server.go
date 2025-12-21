package main

import(
	"net/http"
	"log"
	"os"
)

func StartServer() {
	http.HandleFunc("/ws", wsHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	addr := ":" + port
	log.Println("Listening on", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal("server error:", err)
	}
}