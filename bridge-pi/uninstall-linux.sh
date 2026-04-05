#!/bin/bash
# Cast Away - Linux Uninstaller (Multi-Instance Support)

echo ""
echo "========================================"
echo "  Cast Away Avinstallation"
echo "========================================"
echo ""

# Hitta alla installationer
echo "Söker efter installerade bridges..."
echo ""

SERVICES=$(systemctl --user list-units --all --type=service | grep "cast-away" | awk '{print $1}' | sed 's/.service$//')
FOLDERS=$(find "$HOME/.local/share" -maxdepth 1 -type d -name "cast-away*" 2>/dev/null)

declare -a INSTALLATIONS

index=1

for service in $SERVICES; do
    folder="$HOME/.local/share/$service"
    echo "  [$index] $service"
    if [ -d "$folder" ]; then
        echo "      Mapp: $folder"
    fi
    INSTALLATIONS+=("$service|$folder")
    ((index++))
done

for folder in $FOLDERS; do
    folder_name=$(basename "$folder")
    exists=false
    for install in "${INSTALLATIONS[@]}"; do
        if [[ "$install" == *"$folder_name"* ]]; then
            exists=true
            break
        fi
    done
    
    if [ "$exists" = false ]; then
        echo "  [$index] $folder_name (endast mapp)"
        echo "      Mapp: $folder"
        INSTALLATIONS+=("|$folder")
        ((index++))
    fi
done

if [ ${#INSTALLATIONS[@]} -eq 0 ]; then
    echo "Inga Cast Away-installationer hittades."
    exit 0
fi

echo ""
echo "  [A] Avinstallera ALLA"
echo "  [0] Avbryt"
echo ""

read -p "Välj installation att avinstallera: " choice

if [ -z "$choice" ] || [ "$choice" = "0" ]; then
    echo "Avbryter."
    exit 0
fi

declare -a TO_UNINSTALL

if [ "$choice" = "A" ] || [ "$choice" = "a" ]; then
    TO_UNINSTALL=("${INSTALLATIONS[@]}")
else
    choice_num=$((choice - 1))
    if [ $choice_num -ge 0 ] && [ $choice_num -lt ${#INSTALLATIONS[@]} ]; then
        TO_UNINSTALL=("${INSTALLATIONS[$choice_num]}")
    else
        echo "Ogiltigt val."
        exit 1
    fi
fi

echo ""
echo "Avinstallerar..."

for install in "${TO_UNINSTALL[@]}"; do
    IFS='|' read -r service_name folder_path <<< "$install"
    
    if [ -n "$service_name" ]; then
        echo "  Stoppar service: $service_name"
        systemctl --user stop "$service_name" 2>/dev/null || true
        
        echo "  Inaktiverar service: $service_name"
        systemctl --user disable "$service_name" 2>/dev/null || true
        
        echo "  Tar bort service-fil"
        rm -f "$HOME/.config/systemd/user/$service_name.service"
        rm -f "$HOME/.config/systemd/user/$service_name-restart.service"
        rm -f "$HOME/.config/systemd/user/$service_name-restart.timer"
    fi
    
    if [ -n "$folder_path" ] && [ -d "$folder_path" ]; then
        echo "  Tar bort mapp: $folder_path"
        rm -rf "$folder_path"
    fi
    
    display_name=${service_name:-$(basename "$folder_path")}
    echo "  ✓ $display_name avinstallerad"
done

systemctl --user daemon-reload

echo ""
echo "========================================"
echo "  Avinstallation klar!"
echo "========================================"
echo ""
