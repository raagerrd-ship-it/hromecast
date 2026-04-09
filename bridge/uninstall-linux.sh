#!/bin/bash
# Chromecast Bridge - Linux Uninstaller (Multi-Instance Support)

echo ""
echo "========================================"
echo "  Chromecast Bridge Avinstallation"
echo "========================================"
echo ""

# Hitta alla installationer
echo "Söker efter installerade bridges..."
echo ""

SERVICES=$(systemctl --user list-units --all --type=service | grep "chromecast-bridge" | awk '{print $1}' | sed 's/.service$//')
FOLDERS=$(find "$HOME/.local/share" -maxdepth 1 -type d -name "chromecast-bridge*" 2>/dev/null)

declare -a INSTALLATIONS

index=1

# Lista services
for service in $SERVICES; do
    folder="$HOME/.local/share/$service"
    echo "  [$index] $service"
    if [ -d "$folder" ]; then
        echo "      Mapp: $folder"
    fi
    INSTALLATIONS+=("$service|$folder")
    ((index++))
done

# Lista mappar utan service
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
    echo "Inga Chromecast Bridge-installationer hittades."
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
        # Stoppa och inaktivera alla relaterade units
        for unit in "$service_name" "$service_name-restart" "$service_name-update"; do
            systemctl --user stop "$unit" 2>/dev/null || true
            systemctl --user disable "$unit" 2>/dev/null || true
        done
        
        # Stoppa och inaktivera timers
        for timer in "$service_name-restart" "$service_name-update"; do
            systemctl --user stop "$timer.timer" 2>/dev/null || true
            systemctl --user disable "$timer.timer" 2>/dev/null || true
        done
        
        # Ta bort alla service- och timer-filer
        echo "  Tar bort service-filer för $service_name..."
        rm -f "$HOME/.config/systemd/user/$service_name.service"
        rm -f "$HOME/.config/systemd/user/$service_name-restart.service"
        rm -f "$HOME/.config/systemd/user/$service_name-restart.timer"
        rm -f "$HOME/.config/systemd/user/$service_name-update.service"
        rm -f "$HOME/.config/systemd/user/$service_name-update.timer"
    fi
    
    if [ -n "$folder_path" ] && [ -d "$folder_path" ]; then
        echo "  Tar bort mapp: $folder_path"
        rm -rf "$folder_path"
    fi
    
    display_name=${service_name:-$(basename "$folder_path")}
    echo "  ✓ $display_name avinstallerad"
done

# Ladda om systemd
systemctl --user daemon-reload

echo ""
echo "========================================"
echo "  Avinstallation klar!"
echo "========================================"
echo ""
