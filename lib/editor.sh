#!/bin/bash

# Shared editor functions for claude-evolve

# Function to get saved editor preference
get_saved_editor() {
  if [[ -f ~/.claudefsd ]]; then
    grep "^editor=" ~/.claudefsd | cut -d'=' -f2
  fi
}

# Function to save editor preference
save_editor_preference() {
  echo "editor=$1" > ~/.claudefsd
}

# Function to open file with editor
open_with_editor() {
  local file="$1"
  local editor_choice="$2"
  local saved_editor
  saved_editor=$(get_saved_editor)
  
  # If no editor choice provided and we have a saved preference, use it
  if [[ -z $editor_choice ]] && [[ -n $saved_editor ]]; then
    editor_choice=$saved_editor
  fi
  
  # If still no editor choice, prompt
  if [[ -z $editor_choice ]]; then
    echo "What editor would you like to use?"
    echo "  1) nano (default)"
    echo "  2) vim"
    echo "  3) code (VS Code)"
    echo "  4) cursor"
    echo "  5) other"
    echo
    read -r -p "Enter your choice [1]: " editor_choice
    editor_choice=${editor_choice:-1}
  fi
  
  case $editor_choice in
    1|""|nano)
      save_editor_preference "nano"
      nano "$file"
      ;;
    2|vim)
      save_editor_preference "vim"
      vim "$file"
      ;;
    3|code)
      save_editor_preference "code"
      code . && sleep 2 && code "$file"
      echo "Opening in VS Code. Please edit the file, then press Enter to continue..."
      read -r -n 1 -s
      ;;
    4|cursor)
      save_editor_preference "cursor"
      cursor . && sleep 2 && cursor "$file"
      echo "Opening in Cursor. Please edit the file, then press Enter to continue..."
      read -r -n 1 -s
      ;;
    5|other)
      echo "Enter the command for your preferred editor:"
      read -r custom_editor
      save_editor_preference "$custom_editor"
      $custom_editor "$file"
      ;;
    *)
      echo "Invalid choice. Using nano as fallback."
      nano "$file"
      ;;
  esac
}