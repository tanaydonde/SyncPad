package main

import(
	"fmt"
	"net/http"
)

func StartServer() {
	fs := http.FileServer(http.Dir("./frontend"))
	http.Handle("/", fs)

	http.HandleFunc("/ws", wsHandler)

	fmt.Println("Listening on http://localhost:8080")
    err := http.ListenAndServe(":8080", nil)
    if err != nil {
        fmt.Println("Error starting server:", err)
    }
}