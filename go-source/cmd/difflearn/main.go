package main

import "difflearn-go/internal/cli"

func main() {
	if err := cli.Execute(); err != nil {
		cli.PrintErrAndExit(err)
	}
}
