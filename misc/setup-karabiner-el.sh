#!/bin/bash
brew install --cask karabiner-elements

mkdir -p ~/.config/karabiner

cd ~/dotfiles

stow karabiner -t ../.config/karabiner
